import type { OrderState } from "@commerce-os/shared";

export interface ChainEvent {
  name: string;
  args: Record<string, unknown>;
  blockNumber: bigint;
  logIndex: number;
}

/**
 * Derive an order's state from its confirmed escrow events. Pure and order-independent of
 * how many times it runs, so the indexer can replay safely after retries or reorgs.
 * `base` is the off-chain state before any payment (AWAITING_PAYMENT or CANCELLED).
 */
export function deriveOrderState(base: OrderState, events: ChainEvent[]): OrderState {
  const sorted = [...events].sort((a, b) => (a.blockNumber === b.blockNumber ? a.logIndex - b.logIndex : a.blockNumber < b.blockNumber ? -1 : 1));
  let s: OrderState = base;
  for (const e of sorted) {
    switch (e.name) {
      case "OrderFunded":
        s = "FUNDED";
        break;
      case "OrderAccepted":
        s = "ACCEPTED";
        break;
      case "OrderFulfilled":
        s = "FULFILLED";
        break;
      case "OrderReleased":
        s = "RELEASED";
        break;
      case "OrderRefunded":
        s = "REFUNDED";
        break;
      case "OrderDisputed":
        s = "DISPUTED";
        break;
      case "DisputeResolved":
        s = BigInt(String(e.args.sellerAmount ?? 0)) === 0n && BigInt(String(e.args.feeAmount ?? 0)) === 0n ? "REFUNDED" : "RELEASED";
        break;
    }
  }
  return s;
}
