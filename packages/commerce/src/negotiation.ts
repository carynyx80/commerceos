import { encodeAbiParameters, keccak256, type Hex } from "viem";
import { audit, enqueueJob, notify, prisma, type Negotiation, type Offer, type OfferParty, type PaymentAssetKind } from "@commerce-os/database";
import { formatUsd, sellerDecision } from "@commerce-os/shared";
import { CommerceError } from "./errors";

export const NEGOTIATION_TTL_MS = 24 * 3600_000;
export const OFFER_TTL_MS = 2 * 3600_000;
/** After acceptance the buyer has this long to check out at the agreed price. */
export const ACCEPTED_TTL_MS = 2 * 3600_000;
export const MAX_ROUNDS = 6;

export function offerTermsHash(o: { negotiationId: string; productId: string; buyerId: string; storeId: string; priceCents: number; quantity: number; asset: string; expiresAt: Date }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "string" }, { type: "string" }, { type: "uint256" }],
      [o.negotiationId, o.productId, o.buyerId, o.storeId, BigInt(o.priceCents), BigInt(o.quantity), "USD", o.asset, BigInt(Math.floor(o.expiresAt.getTime() / 1000))],
    ),
  );
}

export type NegotiationView = Negotiation & { offers: Offer[] };

async function load(id: string) {
  const n = await prisma.negotiation.findUnique({
    where: { id },
    include: { offers: { orderBy: { createdAt: "asc" } }, product: { include: { inventory: true } }, store: { include: { merchant: true } }, sellerAgent: true },
  });
  if (!n) throw new CommerceError(404, "NOT_FOUND", "Negotiation not found.");
  if (n.status === "OPEN" && n.expiresAt < new Date()) {
    await prisma.negotiation.update({ where: { id }, data: { status: "EXPIRED" } });
    n.status = "EXPIRED";
  }
  return n;
}

export async function getNegotiation(id: string, viewer: { userId: string; role?: string }) {
  const n = await load(id);
  const isBuyer = n.buyerId === viewer.userId;
  const isSeller = n.store.merchant.userId === viewer.userId;
  if (!isBuyer && !isSeller && viewer.role !== "ADMIN") throw new CommerceError(403, "FORBIDDEN", "Not your negotiation.");
  return {
    id: n.id,
    status: n.status,
    productId: n.productId,
    productTitle: n.product.title,
    listPriceCents: n.product.priceCents,
    storeId: n.storeId,
    storeName: n.store.name,
    quantity: n.quantity,
    asset: n.asset,
    agreedCents: n.agreedCents,
    rounds: n.rounds,
    expiresAt: n.expiresAt,
    buyerAgentId: n.buyerAgentId,
    sellerAgentActive: Boolean(n.sellerAgent && n.sellerAgent.status === "ACTIVE"),
    role: isBuyer ? "buyer" : isSeller ? "seller" : "admin",
    offers: n.offers.map((o) => ({ id: o.id, from: o.from, priceCents: o.priceCents, quantity: o.quantity, message: o.message, status: o.status, byAgent: o.byAgent, termsHash: o.termsHash, expiresAt: o.expiresAt, createdAt: o.createdAt })),
  };
}

/** Start a negotiation on a negotiable listing. Reuses an open one for the same buyer and product. */
export async function openNegotiation(input: { buyerId: string; productId: string; quantity: number; asset: PaymentAssetKind; buyerAgentId?: string }) {
  const p = await prisma.product.findUnique({ where: { id: input.productId }, include: { store: { include: { merchant: true, agents: true } }, inventory: true } });
  if (!p || p.status !== "ACTIVE") throw new CommerceError(404, "NOT_FOUND", "Product not available.");
  if (!p.negotiable) throw new CommerceError(400, "NOT_NEGOTIABLE", "This seller does not negotiate on this listing.");
  if (p.store.merchant.userId === input.buyerId) throw new CommerceError(400, "OWN_PRODUCT", "You cannot negotiate with your own store.");
  if (!p.acceptedAssets.includes(input.asset)) throw new CommerceError(400, "ASSET_NOT_ACCEPTED", `This listing does not accept ${input.asset}.`);
  const available = (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0);
  if (available < input.quantity) throw new CommerceError(409, "INSUFFICIENT_STOCK", `Only ${Math.max(0, available)} available.`);
  const existing = await prisma.negotiation.findFirst({ where: { buyerId: input.buyerId, productId: p.id, status: "OPEN", expiresAt: { gt: new Date() } } });
  if (existing) return existing;
  const sellerAgent = p.store.agents.find((a) => a.type === "SELLER" && a.status === "ACTIVE");
  const n = await prisma.negotiation.create({
    data: {
      productId: p.id,
      storeId: p.storeId,
      buyerId: input.buyerId,
      buyerAgentId: input.buyerAgentId,
      sellerAgentId: sellerAgent?.id,
      quantity: input.quantity,
      asset: input.asset,
      expiresAt: new Date(Date.now() + NEGOTIATION_TTL_MS),
    },
  });
  await audit(prisma, { actorId: input.buyerId, actorType: input.buyerAgentId ? "agent" : "user", action: "negotiation.open", target: n.id });
  return n;
}

/** A party makes an offer (or counter). Buyer offers trigger the seller's agent when one is active. */
export async function submitOffer(input: { negotiationId: string; actorUserId: string; from: OfferParty; priceCents: number; message?: string; byAgent?: boolean; agentId?: string }) {
  const n = await load(input.negotiationId);
  if (n.status !== "OPEN") throw new CommerceError(409, "NEGOTIATION_CLOSED", `This negotiation is ${n.status.toLowerCase()}.`);
  if (input.from === "BUYER" && n.buyerId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Only the buyer can make buyer offers.");
  if (input.from === "SELLER" && n.store.merchant.userId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Only the seller can counter.");
  if (n.rounds >= MAX_ROUNDS) throw new CommerceError(409, "TOO_MANY_ROUNDS", "This negotiation reached its round limit.");
  if (!Number.isInteger(input.priceCents) || input.priceCents <= 0) throw new CommerceError(400, "BAD_PRICE", "Offer must be a positive whole number of cents.");
  if (input.priceCents > n.product.priceCents) throw new CommerceError(400, "ABOVE_LIST", "Offers cannot exceed the list price. Buy at list instead.");
  const last = n.offers.at(-1);
  if (last && last.status === "PENDING" && last.from === input.from) throw new CommerceError(409, "AWAITING_REPLY", "Wait for the other side to respond.");

  const expiresAt = new Date(Math.min(Date.now() + OFFER_TTL_MS, n.expiresAt.getTime()));
  const termsHash = offerTermsHash({ negotiationId: n.id, productId: n.productId, buyerId: n.buyerId, storeId: n.storeId, priceCents: input.priceCents, quantity: n.quantity, asset: n.asset, expiresAt });
  const offer = await prisma.$transaction(async (tx) => {
    await tx.offer.updateMany({ where: { negotiationId: n.id, status: "PENDING" }, data: { status: "COUNTERED" } });
    const o = await tx.offer.create({
      data: { negotiationId: n.id, from: input.from, priceCents: input.priceCents, quantity: n.quantity, message: (input.message ?? "").slice(0, 1000), termsHash, byAgent: Boolean(input.byAgent), expiresAt },
    });
    await tx.negotiation.update({ where: { id: n.id }, data: { rounds: { increment: 1 } } });
    return o;
  });
  await audit(prisma, { actorId: input.actorUserId, actorType: input.byAgent ? "agent" : "user", action: "offer.submit", target: offer.id, data: { from: input.from, priceCents: input.priceCents } });

  if (input.from === "BUYER") {
    if (n.sellerAgent && n.sellerAgent.status === "ACTIVE") {
      await enqueueJob(prisma, "agent.seller_respond", { negotiationId: n.id, offerId: offer.id }, { idempotencyKey: `seller_respond:${offer.id}` });
    } else {
      await notify(prisma, n.store.merchant.userId, { kind: "offer.new", title: "New offer", body: `${formatUsd(input.priceCents)} for ${n.product.title}`, href: "/sell?tab=offers" });
    }
  } else {
    await notify(prisma, n.buyerId, { kind: "offer.counter", title: "Seller countered", body: `${formatUsd(input.priceCents)} for ${n.product.title}`, href: `/workspace?negotiation=${n.id}` });
  }
  return offer;
}

/** Accept the other side's latest pending offer. Locks the agreed price for a short checkout window. */
export async function acceptOffer(input: { negotiationId: string; actorUserId: string; as: OfferParty; byAgent?: boolean }) {
  const n = await load(input.negotiationId);
  if (n.status !== "OPEN") throw new CommerceError(409, "NEGOTIATION_CLOSED", `This negotiation is ${n.status.toLowerCase()}.`);
  if (input.as === "BUYER" && n.buyerId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Not your negotiation.");
  if (input.as === "SELLER" && n.store.merchant.userId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Not your store.");
  const last = n.offers.at(-1);
  if (!last || last.status !== "PENDING" || last.from === input.as) throw new CommerceError(409, "NOTHING_TO_ACCEPT", "There is no pending offer from the other side.");
  if (last.expiresAt < new Date()) {
    await prisma.offer.update({ where: { id: last.id }, data: { status: "EXPIRED" } });
    throw new CommerceError(409, "OFFER_EXPIRED", "That offer expired.");
  }
  await prisma.$transaction([
    prisma.offer.update({ where: { id: last.id }, data: { status: "ACCEPTED" } }),
    prisma.negotiation.update({ where: { id: n.id }, data: { status: "ACCEPTED", agreedCents: last.priceCents, expiresAt: new Date(Date.now() + ACCEPTED_TTL_MS) } }),
  ]);
  await audit(prisma, { actorId: input.actorUserId, actorType: input.byAgent ? "agent" : "user", action: "offer.accept", target: last.id, data: { priceCents: last.priceCents } });
  const to = input.as === "SELLER" ? n.buyerId : n.store.merchant.userId;
  await notify(prisma, to, { kind: "offer.accepted", title: "Offer accepted", body: `${formatUsd(last.priceCents)} for ${n.product.title}. Checkout is open for 2 hours.`, href: input.as === "SELLER" ? `/workspace?negotiation=${n.id}` : "/sell?tab=offers" });
  return { agreedCents: last.priceCents };
}

export async function rejectNegotiation(input: { negotiationId: string; actorUserId: string; as: OfferParty; byAgent?: boolean; reason?: string }) {
  const n = await load(input.negotiationId);
  if (n.status !== "OPEN") return;
  if (input.as === "BUYER" && n.buyerId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Not your negotiation.");
  if (input.as === "SELLER" && n.store.merchant.userId !== input.actorUserId) throw new CommerceError(403, "FORBIDDEN", "Not your store.");
  await prisma.$transaction([
    prisma.offer.updateMany({ where: { negotiationId: n.id, status: "PENDING" }, data: { status: "REJECTED" } }),
    prisma.negotiation.update({ where: { id: n.id }, data: { status: input.as === "BUYER" ? "CANCELLED" : "REJECTED" } }),
  ]);
  const to = input.as === "SELLER" ? n.buyerId : n.store.merchant.userId;
  await notify(prisma, to, { kind: "offer.rejected", title: input.as === "SELLER" ? "Offer declined" : "Buyer withdrew", body: `${n.product.title}${input.reason ? `: ${input.reason}` : ""}`, href: input.as === "SELLER" ? `/workspace?negotiation=${n.id}` : "/sell?tab=offers" });
}

/**
 * The seller agent's turn. The decision is deterministic and bounded by the merchant's floor;
 * `phrase` (an LLM, when configured) may only word the reply, never change the decision.
 */
export async function sellerAgentRespond(negotiationId: string, offerId: string, phrase?: (d: { action: string; priceCents?: number; offerCents: number; productTitle: string }) => Promise<string>) {
  const n = await load(negotiationId);
  if (n.status !== "OPEN") return { action: "NONE" as const };
  const offer = n.offers.find((o) => o.id === offerId);
  if (!offer || offer.status !== "PENDING" || offer.from !== "BUYER") return { action: "NONE" as const };
  const agent = n.sellerAgent;
  if (!agent || agent.status !== "ACTIVE") return { action: "NONE" as const };

  const floor = n.product.floorPriceCents ?? n.product.priceCents;
  const lastSeller = [...n.offers].reverse().find((o) => o.from === "SELLER");
  const decision = sellerDecision({ listPriceCents: n.product.priceCents, floorPriceCents: floor, offerCents: offer.priceCents, round: n.rounds, maxRounds: MAX_ROUNDS, lastSellerCents: lastSeller?.priceCents ?? null });
  const sellerUser = n.store.merchant.userId;
  const fallback =
    decision.action === "ACCEPT"
      ? `Accepted at ${formatUsd(offer.priceCents)}.`
      : decision.action === "COUNTER"
        ? `We can do ${formatUsd(decision.priceCents)}.`
        : `We can't go that low. ${decision.reason}`;
  let message = fallback;
  if (phrase) {
    try {
      message = (await phrase({ action: decision.action, priceCents: decision.action === "COUNTER" ? decision.priceCents : undefined, offerCents: offer.priceCents, productTitle: n.product.title })).slice(0, 600) || fallback;
    } catch {
      message = fallback;
    }
  }
  if (decision.action === "ACCEPT") {
    await acceptOffer({ negotiationId, actorUserId: sellerUser, as: "SELLER", byAgent: true });
  } else if (decision.action === "COUNTER") {
    await submitOffer({ negotiationId, actorUserId: sellerUser, from: "SELLER", priceCents: decision.priceCents, message, byAgent: true, agentId: agent.id });
  } else {
    await rejectNegotiation({ negotiationId, actorUserId: sellerUser, as: "SELLER", byAgent: true, reason: decision.reason });
  }
  await audit(prisma, { actorId: agent.id, actorType: "agent", action: `seller_agent.${decision.action.toLowerCase()}`, target: negotiationId, data: { offerCents: offer.priceCents, ...(decision.action === "COUNTER" ? { counterCents: decision.priceCents } : {}) } });
  return { ...decision, message };
}
