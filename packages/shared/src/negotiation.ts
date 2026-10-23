export type NegotiationStatus = "OPEN" | "ACCEPTED" | "REJECTED" | "EXPIRED" | "CANCELLED" | "CONVERTED";
export type OfferStatus = "PENDING" | "ACCEPTED" | "REJECTED" | "COUNTERED" | "EXPIRED" | "WITHDRAWN";
export type OfferParty = "BUYER" | "SELLER";

/** Structured offer message exchanged between buyer and seller agents. */
export interface OfferMessage {
  negotiationId: string;
  productId: string;
  buyer: string;
  seller: string;
  priceCents: number;
  currency: "USD";
  settlementAsset: "USDG" | "ETH";
  quantity: number;
  expiresAt: string;
  termsHash: `0x${string}`;
  status: OfferStatus;
  from: OfferParty;
}

/**
 * Deterministic seller decision given the merchant's limits. The LLM may phrase
 * the reply, but this function is the authority on accept / counter / reject.
 */
export function sellerDecision(input: {
  listPriceCents: number;
  floorPriceCents: number;
  offerCents: number;
  round: number;
  maxRounds: number;
}): { action: "ACCEPT" } | { action: "COUNTER"; priceCents: number } | { action: "REJECT"; reason: string } {
  const { listPriceCents, floorPriceCents, offerCents, round, maxRounds } = input;
  const floor = Math.min(Math.max(floorPriceCents, 0), listPriceCents);
  if (offerCents >= listPriceCents) return { action: "ACCEPT" };
  if (offerCents >= floor) {
    // Accept outright if within 2% of list or past the midpoint of the concession range late in the talks.
    if (offerCents >= Math.ceil(listPriceCents * 0.98)) return { action: "ACCEPT" };
    if (round >= maxRounds - 1) return { action: "ACCEPT" };
    const counter = Math.max(floor, Math.round((offerCents + listPriceCents) / 2 / 100) * 100);
    return counter <= offerCents ? { action: "ACCEPT" } : { action: "COUNTER", priceCents: counter };
  }
  if (round >= maxRounds) return { action: "REJECT", reason: "Offer is below what the merchant allows." };
  return { action: "COUNTER", priceCents: Math.max(floor, Math.round((floor + listPriceCents) / 2 / 100) * 100) };
}
