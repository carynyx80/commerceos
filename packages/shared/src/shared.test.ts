import { describe, expect, it } from "vitest";
import { splitFee, centsToUsdg, centsToWei, canTransition, sellerDecision } from "./index";

describe("money", () => {
  it("splits a 100 USDG order into 98 / 2", () => {
    const { fee, seller } = splitFee(centsToUsdg(10_000));
    expect(fee).toBe(2_000_000n);
    expect(seller).toBe(98_000_000n);
  });
  it("rounds ETH conversion up", () => {
    // $100 at $2,500.00000000/ETH = 0.04 ETH
    expect(centsToWei(10_000, 2_500_00000000n)).toBe(40_000_000_000_000_000n);
    expect(centsToWei(1, 3_000_00000000n)).toBe(3_333_333_333_334n);
  });
});

describe("order transitions", () => {
  it("cannot release before funding", () => {
    expect(canTransition("AWAITING_PAYMENT", "RELEASED")).toBe(false);
    expect(canTransition("FULFILLED", "RELEASED")).toBe(true);
    expect(canTransition("RELEASED", "REFUNDED")).toBe(false);
  });
});

describe("seller decision", () => {
  const base = { listPriceCents: 10_000, floorPriceCents: 8_500, round: 1, maxRounds: 4 };
  it("accepts list price", () => expect(sellerDecision({ ...base, offerCents: 10_000 }).action).toBe("ACCEPT"));
  it("counters within range", () => {
    const d = sellerDecision({ ...base, offerCents: 9_000 });
    expect(d).toEqual({ action: "COUNTER", priceCents: 9_500 });
  });
  it("never counters below floor", () => {
    const d = sellerDecision({ ...base, offerCents: 5_000 });
    expect(d.action).toBe("COUNTER");
    if (d.action === "COUNTER") expect(d.priceCents).toBeGreaterThanOrEqual(8_500);
  });
  it("rejects lowball on last round", () =>
    expect(sellerDecision({ ...base, offerCents: 5_000, round: 4 }).action).toBe("REJECT"));
});
