import { describe, expect, it } from "vitest";
import { splitFee, centsToStable, centsToUsdg, centsToWei, canTransition, sellerDecision, assetsOn } from "./index";

describe("money", () => {
  it("splits a 100 USDG order into 98 / 2", () => {
    const { fee, seller } = splitFee(centsToUsdg(10_000));
    expect(fee).toBe(2_000_000n);
    expect(seller).toBe(98_000_000n);
  });
  it("scales stablecoins by their own decimals", () => {
    expect(centsToStable(10_000, 6)).toBe(100_000_000n); // 100 USDG
    expect(centsToStable(10_000, 18)).toBe(100n * 10n ** 18n); // 100 BNB Chain USDC
    expect(splitFee(centsToStable(10_000, 18)).fee).toBe(2n * 10n ** 18n);
  });
  it("maps assets to networks", () => {
    expect(assetsOn("robinhood")).toEqual(["USDG", "ETH"]);
    expect(assetsOn("bnb")).toEqual(["USDC", "BNB"]);
  });
  it("prices BNB like ETH (18 decimals, 8-decimal feed)", () => {
    // $100 at $729.05 = 0.137164… BNB, rounded up
    expect(centsToWei(10_000, 72_905_000_000n)).toBe(137164803511418970n);
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
  it("never raises its own previous counter", () => {
    // list 480, floor 440: after countering 460, a buyer move to 450 must not get 465 back
    const d = sellerDecision({ listPriceCents: 48_000, floorPriceCents: 44_000, offerCents: 45_000, round: 3, maxRounds: 6, lastSellerCents: 46_000 });
    expect(d).toEqual({ action: "COUNTER", priceCents: 46_000 });
  });
  it("accepts when the capped counter would not beat the offer", () => {
    const d = sellerDecision({ listPriceCents: 48_000, floorPriceCents: 44_000, offerCents: 45_000, round: 3, maxRounds: 6, lastSellerCents: 45_000 });
    expect(d.action).toBe("ACCEPT");
  });
  it("rejects lowball on last round", () =>
    expect(sellerDecision({ ...base, offerCents: 5_000, round: 4 }).action).toBe("REJECT"));
});
