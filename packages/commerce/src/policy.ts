import { prisma, type Agent, type AgentPolicy, type PaymentAssetKind } from "@commerce-os/database";
import { formatUsd } from "@commerce-os/shared";

export interface PolicyCheck {
  allowed: boolean;
  reasons: string[];
  spentInWindowCents: number;
  remainingCents: number;
  maxPerOrderCents: number;
  expiresAt: string | null;
}

const COUNTED = ["AWAITING_PAYMENT", "FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED", "RELEASED", "DISPUTED"] as const;

/**
 * Off-chain mirror of AgentPolicyModule, used to explain decisions and stop bad purchases
 * early. It is NOT the authority for autonomous payments: the contract re-checks on-chain.
 */
export async function checkSpendingPolicy(agent: Agent & { policy: AgentPolicy | null }, req: { totalCents: number; storeId: string; asset: PaymentAssetKind; category?: string }): Promise<PolicyCheck> {
  const p = agent.policy;
  const reasons: string[] = [];
  if (!p) return { allowed: false, reasons: ["This agent has no spending policy. Purchases need your approval."], spentInWindowCents: 0, remainingCents: 0, maxPerOrderCents: 0, expiresAt: null };
  const since = new Date(Date.now() - p.rollingWindowDays * 86400_000);
  const spent = await prisma.order.aggregate({ where: { agentId: agent.id, createdAt: { gte: since }, state: { in: [...COUNTED] } }, _sum: { totalCents: true } });
  const spentCents = spent._sum.totalCents ?? 0;

  if (agent.status !== "ACTIVE") reasons.push(`Agent is ${agent.status.toLowerCase()}.`);
  if (p.revokedAt) reasons.push("Spending authorization was revoked.");
  if (p.expiresAt < new Date()) reasons.push("Spending authorization expired.");
  if (!p.allowedAssets.includes(req.asset)) reasons.push(`${req.asset} is not an allowed payment asset.`);
  if (p.approvedStoreIds.length && !p.approvedStoreIds.includes(req.storeId)) reasons.push("Seller is not on the approved list.");
  if (req.category && p.approvedCategories.length && !p.approvedCategories.map((c) => c.toLowerCase()).includes(req.category.toLowerCase())) reasons.push(`Category ${req.category} is not approved.`);
  if (req.totalCents > p.maxPerOrderCents) reasons.push(`${formatUsd(req.totalCents)} exceeds the per-order limit of ${formatUsd(p.maxPerOrderCents)}.`);
  if (spentCents + req.totalCents > p.rollingLimitCents) reasons.push(`Would exceed the ${p.rollingWindowDays}-day limit of ${formatUsd(p.rollingLimitCents)} (already ${formatUsd(spentCents)}).`);

  return {
    allowed: reasons.length === 0,
    reasons,
    spentInWindowCents: spentCents,
    remainingCents: Math.max(0, p.rollingLimitCents - spentCents),
    maxPerOrderCents: p.maxPerOrderCents,
    expiresAt: p.expiresAt.toISOString(),
  };
}
