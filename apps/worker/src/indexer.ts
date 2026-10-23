import { decodeEventLog, type Log } from "viem";
import { commerceEscrowAbi, deriveOrderState } from "@commerce-os/blockchain";
import { chainConfig, deployment, publicClient } from "@commerce-os/commerce";
import { audit, notify, prisma, type OrderState } from "@commerce-os/database";
import { formatUsd } from "@commerce-os/shared";

const CONFIRMATIONS = BigInt(process.env.CONFIRMATIONS ?? (chainConfig.chainId === 31337 ? 0 : 3));
const MAX_RANGE = BigInt(process.env.INDEXER_MAX_RANGE ?? 2_000);
const REORG_REWIND = 64n;

const cursorId = () => `escrow:${chainConfig.chainId}`;

/**
 * Index CommerceEscrow events up to (head - CONFIRMATIONS). Idempotent: events are unique by
 * (chainId, txHash, logIndex), and order state is re-derived from the full event set every time.
 * Reorgs: if the stored cursor's block hash no longer matches the chain, rewind and drop events
 * above the rewind point, then re-index.
 */
export async function indexOnce(log: (m: string) => void): Promise<number> {
  const d = deployment();
  const client = publicClient();
  const head = await client.getBlockNumber();
  const safe = head - CONFIRMATIONS;
  if (safe < 0n) return 0;

  let cursor = await prisma.indexerCursor.findUnique({ where: { id: cursorId() } });
  let from = cursor ? cursor.blockNumber + 1n : BigInt(d.deployedAtBlock);

  if (cursor) {
    const b = await client.getBlock({ blockNumber: cursor.blockNumber }).catch(() => null);
    if (!b || b.hash !== cursor.blockHash) {
      const rewindTo = cursor.blockNumber > REORG_REWIND ? cursor.blockNumber - REORG_REWIND : BigInt(d.deployedAtBlock);
      log(`reorg detected at ${cursor.blockNumber}; rewinding to ${rewindTo}`);
      const affected = await prisma.escrowEvent.findMany({ where: { chainId: chainConfig.chainId, blockNumber: { gt: rewindTo } }, select: { orderId: true } });
      await prisma.escrowEvent.deleteMany({ where: { chainId: chainConfig.chainId, blockNumber: { gt: rewindTo } } });
      const rb = await client.getBlock({ blockNumber: rewindTo });
      cursor = await prisma.indexerCursor.update({ where: { id: cursorId() }, data: { blockNumber: rewindTo, blockHash: rb.hash! } });
      for (const id of new Set(affected.map((a) => a.orderId).filter(Boolean) as string[])) await syncOrder(id, log);
      from = rewindTo + 1n;
    }
  }
  if (from > safe) return 0;
  const to = from + MAX_RANGE - 1n < safe ? from + MAX_RANGE - 1n : safe;

  const logs = await client.getLogs({ address: d.escrow, fromBlock: from, toBlock: to });
  const touched = new Set<string>();
  for (const l of logs as Log[]) {
    let ev: { eventName: string; args: Record<string, unknown> };
    try {
      ev = decodeEventLog({ abi: commerceEscrowAbi, data: l.data, topics: l.topics }) as never;
    } catch {
      continue;
    }
    const orderOnchainId = (ev.args.orderId as string | undefined)?.toLowerCase();
    if (!orderOnchainId) continue; // admin events
    const order = await prisma.order.findFirst({ where: { onchainId: { equals: orderOnchainId, mode: "insensitive" } } });
    const args = JSON.parse(JSON.stringify(ev.args, (_, v) => (typeof v === "bigint" ? v.toString() : v)));
    await prisma.escrowEvent.upsert({
      where: { chainId_txHash_logIndex: { chainId: chainConfig.chainId, txHash: l.transactionHash!, logIndex: l.logIndex! } },
      create: {
        chainId: chainConfig.chainId,
        blockNumber: l.blockNumber!,
        blockHash: l.blockHash!,
        txHash: l.transactionHash!,
        logIndex: l.logIndex!,
        name: ev.eventName,
        orderOnchainId,
        orderId: order?.id,
        args,
      },
      update: {},
    });
    if (order) touched.add(order.id);
    else log(`event ${ev.eventName} for unknown order ${orderOnchainId}`);
  }

  const tb = await client.getBlock({ blockNumber: to });
  await prisma.indexerCursor.upsert({
    where: { id: cursorId() },
    create: { id: cursorId(), blockNumber: to, blockHash: tb.hash! },
    update: { blockNumber: to, blockHash: tb.hash! },
  });
  for (const id of touched) await syncOrder(id, log);
  return logs.length;
}

const NOTICES: Partial<Record<OrderState, (title: string, total: string) => { buyer?: [string, string]; seller?: [string, string] }>> = {
  FUNDED: (t, v) => ({ buyer: ["Payment confirmed", `${v} for ${t} is locked in escrow.`], seller: ["New paid order", `${t} · ${v} in escrow. Accept it to start fulfilment.`] }),
  ACCEPTED: (t) => ({ buyer: ["Seller accepted your order", t] }),
  FULFILLED: (t) => ({ buyer: ["Order marked fulfilled", `${t}. Confirm delivery to release payment, or open a dispute.`] }),
  RELEASED: (t, v) => ({ buyer: ["Order settled", t], seller: ["Settlement received", `${t} · ${v} (less the 2% fee) sent to your payout wallet.`] }),
  REFUNDED: (t, v) => ({ buyer: ["Refund completed", `${v} for ${t} was returned to your wallet.`], seller: ["Order refunded", t] }),
  DISPUTED: (t) => ({ buyer: ["Dispute opened", `${t}. Funds stay locked until resolved.`], seller: ["Dispute opened", `${t}. Funds stay locked until resolved.`] }),
};

/** Recompute one order's state from its confirmed events and validate the funding matches the quote. */
export async function syncOrder(orderId: string, log: (m: string) => void) {
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true, store: { include: { merchant: true } } } });
  if (!order) return;
  const events = await prisma.escrowEvent.findMany({ where: { orderId, removed: false } });
  const funded = events.find((e) => e.name === "OrderFunded");
  if (funded) {
    const a = funded.args as Record<string, string>;
    const ok =
      a.buyer?.toLowerCase() === order.buyerAddress && a.seller?.toLowerCase() === order.sellerAddress && a.amount === order.amount;
    if (!ok) {
      log(`order ${orderId}: funding does not match quote`);
      await audit(prisma, { actorType: "system", action: "security.funding_mismatch", target: orderId, data: { args: a } });
      return;
    }
  }
  // Funds arriving for an order we had already expired: the escrow still holds them, so follow the chain.
  const base: OrderState = order.state === "CANCELLED" && !funded ? "CANCELLED" : "AWAITING_PAYMENT";
  let next = deriveOrderState(base, events.map((e) => ({ name: e.name, args: e.args as Record<string, unknown>, blockNumber: e.blockNumber, logIndex: e.logIndex })));
  // IN_FULFILLMENT is an off-chain refinement of ACCEPTED (tracking added).
  if (next === "ACCEPTED" && order.state === "IN_FULFILLMENT") next = "IN_FULFILLMENT";
  if (next === order.state) return;

  const prev = order.state;
  await prisma.$transaction(async (tx) => {
    const lastTx = events.sort((x, y) => Number(y.blockNumber - x.blockNumber) || y.logIndex - x.logIndex)[0]?.txHash;
    // Compare-and-set on the previous state: if another worker (or the payment.verify job) already
    // applied this transition, do nothing, so inventory and notifications are never applied twice.
    const cas = await tx.order.updateMany({ where: { id: orderId, state: prev }, data: { state: next, feeBps: funded ? Number((funded.args as any).feeBps) : undefined } });
    if (cas.count !== 1) return;
    await tx.orderTransition.create({ data: { orderId, from: prev, to: next, source: "indexer", txHash: lastTx } });
    if (funded && (prev === "AWAITING_PAYMENT" || prev === "CANCELLED")) {
      await tx.payment.updateMany({ where: { orderId, txHash: funded.txHash.toLowerCase() }, data: { status: "CONFIRMED" } });
      const exists = await tx.payment.findUnique({ where: { txHash: funded.txHash.toLowerCase() } });
      if (!exists) {
        await tx.payment.create({ data: { orderId, txHash: funded.txHash.toLowerCase(), chainId: chainConfig.chainId, from: order.buyerAddress, asset: order.asset, amount: order.amount, status: "CONFIRMED", byAgent: Boolean(order.agentId) } });
      }
      await tx.checkoutQuote.update({ where: { id: order.quoteId }, data: { usedAt: new Date() } });
      if (prev === "CANCELLED") {
        // re-reserve stock for an order that was paid right at the deadline
        await tx.inventory.update({ where: { productId: order.productId }, data: { reserved: { increment: order.quantity } } });
      }
      const neg = await tx.checkoutQuote.findUnique({ where: { id: order.quoteId } });
      if (neg?.negotiationId) await tx.negotiation.update({ where: { id: neg.negotiationId }, data: { status: "CONVERTED" } });
    }
    // Stock leaves inventory when settled; returns to sale on refund.
    if (next === "RELEASED" && prev !== "RELEASED") {
      await tx.inventory.update({ where: { productId: order.productId }, data: { available: { decrement: order.quantity }, reserved: { decrement: order.quantity } } });
    }
    if (next === "REFUNDED" && prev !== "REFUNDED") {
      await tx.inventory.update({ where: { productId: order.productId }, data: { reserved: { decrement: order.quantity } } });
    }
    if (next === "DISPUTED" || prev === "DISPUTED") {
      const d = await tx.dispute.findUnique({ where: { orderId } });
      if (next === "DISPUTED" && !d) {
        await tx.dispute.create({ data: { orderId, openedBy: "CHAIN", reason: "Dispute opened on-chain.", evidenceDeadline: new Date(Date.now() + 5 * 86400_000) } });
      }
      if (prev === "DISPUTED" && d) {
        await tx.dispute.update({ where: { orderId }, data: { status: next === "REFUNDED" ? "RESOLVED_BUYER" : "RESOLVED_SELLER", resolvedAt: new Date() } });
      }
    }
    const n = NOTICES[next]?.(order.product.title, formatUsd(order.totalCents));
    if (n?.buyer) await notify(tx, order.buyerId, { kind: `order.${next.toLowerCase()}`, title: n.buyer[0], body: n.buyer[1], href: `/orders/${orderId}` });
    if (n?.seller) await notify(tx, order.store.merchant.userId, { kind: `order.${next.toLowerCase()}`, title: n.seller[0], body: n.seller[1], href: `/sell/orders` });
  });
  log(`order ${orderId}: ${prev} → ${next}`);
}
