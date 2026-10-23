import { getAddress, type Address, type Hex } from "viem";
import { FLAGS, audit, flag, prisma, type PaymentAssetKind } from "@commerce-os/database";
import { ETH_TOKEN, escrowDomain, onchainOrderId, quoteTypes, termsHash, type EscrowQuote } from "@commerce-os/blockchain";
import { ASSETS, centsToStable, centsToWei } from "@commerce-os/shared";
import { chainIdForAsset, currentFeeBps, deployment, merchantActiveOnChain, nativeUsdPrice8, quoteSigner } from "./chain";
import { CommerceError } from "./errors";

export const QUOTE_TTL_SECONDS = Number(process.env.QUOTE_TTL_SECONDS ?? 15 * 60);

export interface QuoteRequest {
  buyerId: string;
  /** Wallet (or AgentAccount) that will submit payment. Must equal msg.sender on-chain. */
  payerAddress: string;
  productId: string;
  quantity: number;
  asset: PaymentAssetKind;
  negotiationId?: string;
  agentId?: string;
  shipping?: unknown;
}

export interface QuoteResult {
  orderId: string;
  escrow: Address;
  chainId: number;
  quote: { orderId: Hex; buyer: Address; seller: Address; token: Address; amount: string; deadline: string; termsHash: Hex };
  signature: Hex;
  totalCents: number;
  unitCents: number;
  feeBps: number;
  asset: PaymentAssetKind;
  /** The chain's stablecoin (USDG or USDC) and its decimals. */
  stable: Address;
  stableDecimals: number;
  nativeSymbol: string;
  /** Native/USD price used for ETH or BNB quotes (8 decimals). */
  nativeUsdPrice8: string | null;
  /** @deprecated aliases */
  usdg: Address;
  ethUsdPrice8: string | null;
}

/**
 * Price, validate and sign a checkout. All prices come from the database (list price or a
 * negotiation this buyer won); the client never supplies an amount. Creates the order in
 * AWAITING_PAYMENT and reserves inventory until the quote deadline.
 */
export async function createCheckoutQuote(req: QuoteRequest): Promise<QuoteResult> {
  if (await flag(prisma, FLAGS.checkoutPaused)) throw new CommerceError(503, "CHECKOUT_PAUSED", "Checkout is temporarily paused by the operators. No new payments are being accepted.");
  const chainId = chainIdForAsset(req.asset);
  const d = deployment(chainId);
  const signer = quoteSigner();
  const payer = getAddress(req.payerAddress);

  const product = await prisma.product.findUnique({ where: { id: req.productId }, include: { store: { include: { merchant: true } }, inventory: true } });
  if (!product || product.status !== "ACTIVE" || !product.store.active) throw new CommerceError(404, "NOT_FOUND", "Product not available.");
  if (!product.acceptedAssets.includes(req.asset)) throw new CommerceError(400, "ASSET_NOT_ACCEPTED", `This seller does not accept ${req.asset} for this product.`);
  if (product.store.merchant.userId === req.buyerId) throw new CommerceError(400, "OWN_PRODUCT", "You cannot buy from your own store.");
  const seller = getAddress(product.store.payoutAddress);
  if (seller.toLowerCase() === payer.toLowerCase()) throw new CommerceError(400, "OWN_PRODUCT", "Buyer and seller wallets must differ.");

  // Price: list, or the agreed price of an accepted negotiation owned by this buyer.
  let unitCents = product.priceCents;
  let negotiationId: string | null = null;
  if (req.negotiationId) {
    const n = await prisma.negotiation.findUnique({ where: { id: req.negotiationId } });
    if (!n || n.buyerId !== req.buyerId || n.productId !== product.id) throw new CommerceError(404, "NOT_FOUND", "Negotiation not found.");
    if (n.status !== "ACCEPTED" || n.agreedCents == null) throw new CommerceError(400, "NEGOTIATION_NOT_ACCEPTED", "This negotiation has no accepted price.");
    if (n.expiresAt < new Date()) throw new CommerceError(400, "NEGOTIATION_EXPIRED", "The negotiated price expired.");
    if (n.quantity !== req.quantity) throw new CommerceError(400, "QUANTITY_MISMATCH", `The negotiated price is for quantity ${n.quantity}.`);
    unitCents = n.agreedCents;
    negotiationId = n.id;
  }
  const totalCents = unitCents * req.quantity;

  if (!(await merchantActiveOnChain(seller, chainId))) {
    throw new CommerceError(409, "MERCHANT_NOT_REGISTERED", `This seller's payout wallet is not yet active in the merchant registry on chain ${chainId}.`);
  }

  // Stablecoins use the deployment's real decimals (USDG 6, BNB Chain USDC 18); natives use the chain's feed.
  let amount: bigint;
  let price8: bigint | null = null;
  let token: Address;
  if (ASSETS[req.asset].kind === "stable") {
    amount = centsToStable(totalCents, d.stableDecimals);
    token = d.stable;
  } else {
    price8 = await nativeUsdPrice8(chainId);
    amount = centsToWei(totalCents, price8);
    token = ETH_TOKEN;
  }
  const feeBps = await currentFeeBps(chainId);
  const deadline = BigInt(Math.floor(Date.now() / 1000) + QUOTE_TTL_SECONDS);

  // Reserve stock and create the order atomically. A conditional update prevents overselling.
  const order = await prisma.$transaction(async (tx) => {
    if (negotiationId) {
      const used = await tx.checkoutQuote.findFirst({ where: { negotiationId, usedAt: { not: null } } });
      if (used) throw new CommerceError(409, "NEGOTIATION_USED", "This negotiated price was already used for an order.");
      // A fresh quote replaces any unused earlier quote for the same negotiation.
      const prev = await tx.checkoutQuote.findUnique({ where: { negotiationId } });
      if (prev) {
        const prevOrder = await tx.order.findUnique({ where: { quoteId: prev.id } });
        if (prevOrder && prevOrder.state !== "AWAITING_PAYMENT") throw new CommerceError(409, "NEGOTIATION_USED", "This negotiated price was already used.");
        if (prevOrder) {
          await tx.order.update({ where: { id: prevOrder.id }, data: { state: "CANCELLED", transitions: { create: { from: "AWAITING_PAYMENT", to: "CANCELLED", source: "api" } } } });
          await tx.inventory.update({ where: { productId: product.id }, data: { reserved: { decrement: prevOrder.quantity } } });
        }
        await tx.checkoutQuote.update({ where: { id: prev.id }, data: { negotiationId: null } });
      }
    }
    const reserved = await tx.$executeRaw`
      UPDATE "Inventory" SET reserved = reserved + ${req.quantity}, "updatedAt" = ${new Date()}
      WHERE "productId" = ${product.id} AND available - reserved >= ${req.quantity}`;
    if (reserved !== 1) throw new CommerceError(409, "INSUFFICIENT_STOCK", "Not enough stock for this quantity.");

    const quote = await tx.checkoutQuote.create({
      data: {
        negotiationId,
        productId: product.id,
        buyerId: req.buyerId,
        quantity: req.quantity,
        unitCents,
        totalCents,
        asset: req.asset,
        chainId,
        amount: amount.toString(),
        ethUsdPrice8: price8?.toString(),
        signature: "pending",
        expiresAt: new Date(Number(deadline) * 1000),
      },
    });
    const o = await tx.order.create({
      data: {
        onchainId: "pending",
        buyerId: req.buyerId,
        buyerAddress: payer.toLowerCase(),
        storeId: product.storeId,
        productId: product.id,
        agentId: req.agentId,
        quoteId: quote.id,
        quantity: req.quantity,
        unitCents,
        totalCents,
        feeBps,
        asset: req.asset,
        chainId,
        amount: amount.toString(),
        sellerAddress: seller.toLowerCase(),
        state: "AWAITING_PAYMENT",
        shipping: (req.shipping as object) ?? undefined,
        paymentDeadline: new Date(Number(deadline) * 1000),
        transitions: { create: { from: "CREATED", to: "AWAITING_PAYMENT", source: req.agentId ? "agent" : "api" } },
      },
    });
    return { o, quote };
  });

  const q: EscrowQuote = {
    orderId: onchainOrderId(order.o.id),
    buyer: payer,
    seller,
    token,
    amount,
    deadline,
    termsHash: termsHash({ orderId: order.o.id, productId: product.id, storeId: product.storeId, quantity: req.quantity, unitCents, totalCents, asset: req.asset, negotiationId }),
  };
  const signature = await signer.signTypedData({ domain: escrowDomain(chainId, d.escrow), types: quoteTypes, primaryType: "Quote", message: q });
  await prisma.$transaction([
    prisma.order.update({ where: { id: order.o.id }, data: { onchainId: q.orderId } }),
    prisma.checkoutQuote.update({ where: { id: order.quote.id }, data: { signature } }),
  ]);
  await audit(prisma, { actorId: req.buyerId, actorType: req.agentId ? "agent" : "user", action: "checkout.quote", target: order.o.id, data: { totalCents, asset: req.asset, chainId, negotiationId, agentId: req.agentId ?? null } });

  return {
    orderId: order.o.id,
    escrow: d.escrow,
    chainId,
    quote: { ...q, amount: q.amount.toString(), deadline: q.deadline.toString() },
    signature,
    totalCents,
    unitCents,
    feeBps,
    asset: req.asset,
    stable: d.stable,
    stableDecimals: d.stableDecimals,
    nativeSymbol: d.nativeSymbol,
    nativeUsdPrice8: price8?.toString() ?? null,
    usdg: d.stable,
    ethUsdPrice8: price8?.toString() ?? null,
  };
}

/** Cancel an order that was never paid and release its stock. Idempotent; no-op once paid. */
export async function cancelUnpaidOrder(orderId: string, source: "worker" | "api" = "worker"): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const o = await tx.order.findUnique({ where: { id: orderId } });
    if (!o) return false;
    const n = await tx.order.updateMany({ where: { id: orderId, state: "AWAITING_PAYMENT" }, data: { state: "CANCELLED" } });
    if (n.count !== 1) return false;
    await tx.orderTransition.create({ data: { orderId, from: "AWAITING_PAYMENT", to: "CANCELLED", source } });
    await tx.inventory.update({ where: { productId: o.productId }, data: { reserved: { decrement: o.quantity } } });
    return true;
  });
}

/** Release stock held by unpaid orders whose quote expired. Idempotent. */
export async function expireUnpaidOrders(now = new Date()) {
  const stale = await prisma.order.findMany({ where: { state: "AWAITING_PAYMENT", paymentDeadline: { lt: new Date(now.getTime() - 5 * 60_000) } }, take: 100 });
  for (const o of stale) await cancelUnpaidOrder(o.id);
  return stale.length;
}
