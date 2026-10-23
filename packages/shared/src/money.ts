/**
 * Money is always integer. Prices are stored in USD cents. On-chain amounts are
 * base units of the payment asset (USDG has 6 decimals, ETH has 18).
 */
export const FEE_BPS = 200n; // 2% marketplace fee
export const MAX_FEE_BPS = 1_000n; // contracts refuse anything above 10%
export const BPS = 10_000n;

export type PaymentAsset = "USDG" | "ETH";
export const PAYMENT_ASSETS: readonly PaymentAsset[] = ["USDG", "ETH"] as const;

export const ASSET_DECIMALS: Record<PaymentAsset, number> = { USDG: 6, ETH: 18 };

/** Split an amount into seller proceeds and protocol fee. Fee rounds down. */
export function splitFee(amount: bigint, feeBps: bigint = FEE_BPS) {
  if (amount < 0n) throw new Error("amount must be non-negative");
  if (feeBps > MAX_FEE_BPS) throw new Error("fee above maximum");
  const fee = (amount * feeBps) / BPS;
  return { fee, seller: amount - fee };
}

/** USD cents → USDG base units (6 decimals). 1 cent = 10_000 base units. */
export function centsToUsdg(cents: number | bigint): bigint {
  return BigInt(cents) * 10_000n;
}

/**
 * USD cents → wei given an ETH/USD price expressed with 8 decimals (Chainlink style).
 * Rounds up so the buyer never underpays the quoted USD amount.
 */
export function centsToWei(cents: number | bigint, ethUsdPrice8: bigint): bigint {
  if (ethUsdPrice8 <= 0n) throw new Error("invalid ETH price");
  const num = BigInt(cents) * 10n ** 18n * 10n ** 6n; // cents → USD*1e8 is ×1e6
  return (num + ethUsdPrice8 - 1n) / ethUsdPrice8;
}

export function formatUsd(cents: number | bigint): string {
  const n = Number(cents) / 100;
  return n.toLocaleString("en-US", { style: "currency", currency: "USD" });
}

export function formatUnits(value: bigint, decimals: number, maxFraction = 6): string {
  const neg = value < 0n;
  const v = neg ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  let frac = (v % base).toString().padStart(decimals, "0").slice(0, maxFraction).replace(/0+$/, "");
  return `${neg ? "-" : ""}${whole.toLocaleString("en-US")}${frac ? "." + frac : ""}`;
}
