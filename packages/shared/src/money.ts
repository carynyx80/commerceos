/**
 * Money is always integer. Prices are stored in USD cents. On-chain amounts are
 * base units of the payment asset (USDG has 6 decimals, ETH has 18).
 */
export const FEE_BPS = 200n; // 2% marketplace fee
export const MAX_FEE_BPS = 1_000n; // contracts refuse anything above 10%
export const BPS = 10_000n;

/**
 * Payment assets. USDG and ETH settle on Robinhood Chain; USDC and BNB settle on BNB Chain.
 * Stablecoin decimals differ by chain (USDG 6, BNB Chain USDC 18), so on-chain amounts always
 * use the decimals recorded in the deployment, never a hard-coded value.
 */
export type PaymentAsset = "USDG" | "ETH" | "USDC" | "BNB";
export const PAYMENT_ASSETS: readonly PaymentAsset[] = ["USDG", "ETH", "USDC", "BNB"] as const;
export type Network = "robinhood" | "bnb";

export const ASSETS: Record<PaymentAsset, { network: Network; kind: "stable" | "native"; name: string; defaultDecimals: number }> = {
  USDG: { network: "robinhood", kind: "stable", name: "Global Dollar", defaultDecimals: 6 },
  ETH: { network: "robinhood", kind: "native", name: "Ether", defaultDecimals: 18 },
  USDC: { network: "bnb", kind: "stable", name: "USD Coin", defaultDecimals: 18 },
  BNB: { network: "bnb", kind: "native", name: "BNB", defaultDecimals: 18 },
};

export const NETWORK_LABEL: Record<Network, string> = { robinhood: "Robinhood Chain", bnb: "BNB Chain" };

export function assetsOn(network: Network): PaymentAsset[] {
  return PAYMENT_ASSETS.filter((a) => ASSETS[a].network === network);
}

/** @deprecated use the deployment's stableDecimals; kept for display defaults. */
export const ASSET_DECIMALS: Record<PaymentAsset, number> = { USDG: 6, ETH: 18, USDC: 18, BNB: 18 };

/** Split an amount into seller proceeds and protocol fee. Fee rounds down. */
export function splitFee(amount: bigint, feeBps: bigint = FEE_BPS) {
  if (amount < 0n) throw new Error("amount must be non-negative");
  if (feeBps > MAX_FEE_BPS) throw new Error("fee above maximum");
  const fee = (amount * feeBps) / BPS;
  return { fee, seller: amount - fee };
}

/** USD cents → stablecoin base units for a token with `decimals` (≥ 2). USDG: ×10⁴, BNB Chain USDC: ×10¹⁶. */
export function centsToStable(cents: number | bigint, decimals: number): bigint {
  if (!Number.isInteger(decimals) || decimals < 2 || decimals > 36) throw new Error("unsupported stablecoin decimals");
  return BigInt(cents) * 10n ** BigInt(decimals - 2);
}

/** USD cents → USDG base units (6 decimals). */
export function centsToUsdg(cents: number | bigint): bigint {
  return centsToStable(cents, 6);
}

/**
 * USD cents → wei (18 decimals; ETH and BNB alike) given a native/USD price with 8 decimals
 * (Chainlink style). Rounds up so the buyer never underpays the quoted USD amount.
 */
export function centsToWei(cents: number | bigint, ethUsdPrice8: bigint): bigint {
  if (ethUsdPrice8 <= 0n) throw new Error("invalid native price");
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
