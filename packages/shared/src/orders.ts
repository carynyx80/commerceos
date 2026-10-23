export const ORDER_STATES = [
  "CREATED",
  "AWAITING_PAYMENT",
  "FUNDED",
  "ACCEPTED",
  "IN_FULFILLMENT",
  "FULFILLED",
  "RELEASED",
  "CANCELLED",
  "REFUNDED",
  "DISPUTED",
] as const;
export type OrderState = (typeof ORDER_STATES)[number];

/**
 * Allowed transitions. Transitions out of FUNDED and later are driven by confirmed
 * escrow events (see the indexer); the API may only request them on-chain.
 */
export const ORDER_TRANSITIONS: Record<OrderState, readonly OrderState[]> = {
  CREATED: ["AWAITING_PAYMENT", "CANCELLED"],
  AWAITING_PAYMENT: ["FUNDED", "CANCELLED"],
  FUNDED: ["ACCEPTED", "REFUNDED", "DISPUTED"],
  ACCEPTED: ["IN_FULFILLMENT", "FULFILLED", "REFUNDED", "DISPUTED"],
  IN_FULFILLMENT: ["FULFILLED", "REFUNDED", "DISPUTED"],
  FULFILLED: ["RELEASED", "DISPUTED"],
  RELEASED: [],
  CANCELLED: [],
  REFUNDED: [],
  DISPUTED: ["RELEASED", "REFUNDED"],
};

export function canTransition(from: OrderState, to: OrderState): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertTransition(from: OrderState, to: OrderState): void {
  if (!canTransition(from, to)) throw new Error(`Illegal order transition ${from} → ${to}`);
}

export const TERMINAL_STATES: readonly OrderState[] = ["RELEASED", "CANCELLED", "REFUNDED"];

/** On-chain escrow status enum, mirrored from CommerceEscrow.sol. */
export const ESCROW_STATUS = ["None", "Funded", "Accepted", "Fulfilled", "Released", "Refunded", "Disputed"] as const;
export type EscrowStatus = (typeof ESCROW_STATUS)[number];

export const ORDER_STATE_LABEL: Record<OrderState, string> = {
  CREATED: "Created",
  AWAITING_PAYMENT: "Awaiting payment",
  FUNDED: "Funded in escrow",
  ACCEPTED: "Accepted by seller",
  IN_FULFILLMENT: "In fulfillment",
  FULFILLED: "Fulfilled",
  RELEASED: "Settled",
  CANCELLED: "Cancelled",
  REFUNDED: "Refunded",
  DISPUTED: "In dispute",
};
