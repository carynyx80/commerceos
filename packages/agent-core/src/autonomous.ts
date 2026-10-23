import { BaseError, ContractFunctionRevertedError, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { agentAccountAbi, agentPolicyModuleAbi, chainById, commerceEscrowAbi, ETH_TOKEN } from "@commerce-os/blockchain";
import { ASSETS } from "@commerce-os/shared";

/** Account ABI plus the errors of the contracts it calls, so reverts decode to a named reason. */
const checkoutAbi = [...agentAccountAbi, ...agentPolicyModuleAbi.filter((x) => x.type === "error"), ...commerceEscrowAbi.filter((x) => x.type === "error")];

function revertReason(e: unknown): string {
  if (e instanceof BaseError) {
    const r = e.walk((x) => x instanceof ContractFunctionRevertedError) as ContractFunctionRevertedError | null;
    if (r?.data?.errorName) return `${r.data.errorName}${r.data.args?.length ? `(${r.data.args.map(String).join(", ")})` : ""}`;
    return e.shortMessage;
  }
  return (e as Error)?.message ?? String(e);
}
import { checkSpendingPolicy, deployment, publicClient, rpcUrlFor } from "@commerce-os/commerce";
import { FLAGS, audit, flag, notify, prisma } from "@commerce-os/database";
import { formatUsd } from "@commerce-os/shared";

export function executorAccount() {
  const key = process.env.AGENT_EXECUTOR_PRIVATE_KEY;
  if (!key) return null;
  return privateKeyToAccount(key as Hex);
}

export class PaymentRefused extends Error {}

/**
 * Pay an agent order from the user's AgentAccount. Off-chain checks explain refusals early;
 * the AgentPolicyModule contract is the final authority. Safe to retry: the policy nonce and
 * the escrow's one-payment-per-order rule make a second submission revert instead of paying twice.
 */
export async function executeAgentPayment(orderId: string, agentId: string, log: (m: string) => void = () => {}) {
  if (process.env.AUTONOMOUS_PAYMENTS_ENABLED !== "true") throw new PaymentRefused("Autonomous payments are disabled on this deployment.");
  if (await flag(prisma, FLAGS.agentsPaused)) throw new PaymentRefused("Agent execution is paused platform-wide by the operators.");
  const exec = executorAccount();
  if (!exec) throw new PaymentRefused("AGENT_EXECUTOR_PRIVATE_KEY is not configured.");
  const order = await prisma.order.findUnique({ where: { id: orderId }, include: { product: true } });
  const agent = await prisma.agent.findUnique({ where: { id: agentId }, include: { policy: true } });
  if (!order || !agent || order.agentId !== agent.id) throw new PaymentRefused("Order is not an agent order.");
  if (order.state !== "AWAITING_PAYMENT") return { state: order.state };
  if (!agent.accountAddress) throw new PaymentRefused("Agent has no smart account.");
  if (order.buyerAddress.toLowerCase() !== agent.accountAddress.toLowerCase()) throw new PaymentRefused("Order payer is not the agent account.");

  const check = await checkSpendingPolicy(agent, { totalCents: 0, storeId: order.storeId, asset: order.asset });
  if (!check.allowed) {
    await audit(prisma, { actorId: agent.id, actorType: "agent", action: "agent.payment_refused", target: orderId, data: { reasons: check.reasons } });
    throw new PaymentRefused(check.reasons.join(" "));
  }

  const quote = await prisma.checkoutQuote.findUniqueOrThrow({ where: { id: order.quoteId } });
  if (quote.expiresAt < new Date()) throw new PaymentRefused("Quote expired.");
  // The smart account lives on one chain; it can only pay orders that settle there.
  const chainId = agent.accountChainId ?? order.chainId;
  if (order.chainId !== chainId) throw new PaymentRefused(`This agent's account is on chain ${chainId}; ${order.asset} settles on chain ${order.chainId}.`);
  const d = deployment(chainId);
  const client = publicClient(chainId);
  const account = agent.accountAddress as Hex;
  const policy = await client.readContract({ address: d.policyModule, abi: agentPolicyModuleAbi, functionName: "policies", args: [account] });
  const nonce = policy[7];

  const q = {
    orderId: order.onchainId as Hex,
    buyer: account,
    seller: order.sellerAddress as Hex,
    token: ASSETS[order.asset].kind === "native" ? ETH_TOKEN : d.stable,
    amount: BigInt(order.amount),
    deadline: BigInt(Math.floor(quote.expiresAt.getTime() / 1000)),
    termsHash: (await termsFor(order.id)) as Hex,
  };
  const wallet = createWalletClient({ account: exec, chain: chainById(chainId), transport: http(rpcUrlFor(chainId)) });

  // Simulate first: a policy or escrow revert surfaces here with its reason and costs nothing.
  try {
    await client.simulateContract({ account: exec, address: account, abi: checkoutAbi, functionName: "agentCheckout", args: [q, quote.signature as Hex, nonce] });
  } catch (e) {
    const reason = revertReason(e);
    await audit(prisma, { actorId: agent.id, actorType: "agent", action: "agent.payment_rejected_onchain", target: orderId, data: { reason } });
    await notify(prisma, agent.ownerId, { kind: "agent.payment_rejected", title: "Agent purchase blocked by your policy", body: `${order.product.title} (${formatUsd(order.totalCents)}): ${reason}`, href: `/agents/${agent.id}` });
    throw new PaymentRefused(`On-chain policy rejected the payment: ${reason}`);
  }
  const hash = await wallet.writeContract({ address: account, abi: agentAccountAbi, functionName: "agentCheckout", args: [q, quote.signature as Hex, nonce] });
  await prisma.payment.upsert({ where: { txHash: hash.toLowerCase() }, create: { orderId, txHash: hash.toLowerCase(), chainId, from: account.toLowerCase(), asset: order.asset, amount: order.amount, status: "SUBMITTED", byAgent: true }, update: {} });
  const r = await client.waitForTransactionReceipt({ hash, timeout: 120_000 });
  await audit(prisma, { actorId: agent.id, actorType: "agent", action: "agent.payment_submitted", target: orderId, data: { hash, status: r.status } });
  if (r.status !== "success") throw new Error(`agent payment reverted (${hash})`);
  log(`agent ${agent.id} paid order ${orderId} (${hash})`);
  return { hash };
}

async function termsFor(orderId: string) {
  // The order's termsHash was signed into the quote; recompute it from stored terms.
  const { termsHash } = await import("@commerce-os/blockchain");
  const o = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  const q = await prisma.checkoutQuote.findUniqueOrThrow({ where: { id: o.quoteId } });
  return termsHash({ orderId: o.id, productId: o.productId, storeId: o.storeId, quantity: o.quantity, unitCents: o.unitCents, totalCents: o.totalCents, asset: o.asset, negotiationId: q.negotiationId });
}
