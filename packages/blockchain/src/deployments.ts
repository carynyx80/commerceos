import type { Address } from "viem";

export interface Deployment {
  chainId: number;
  deployedAtBlock: number;
  /** True when the stablecoin is the labelled no-value test token. */
  testToken: boolean;
  /** The chain's stablecoin: USDG on Robinhood Chain, USDC on BNB Chain. */
  stable: Address;
  stableSymbol: string;
  stableDecimals: number;
  nativeSymbol: string;
  escrow: Address;
  merchantRegistry: Address;
  feeController: Address;
  treasury: Address;
  disputeResolver: Address;
  policyModule: Address;
  accountFactory: Address;
  /** Native/USD (ETH/USD or BNB/USD) Chainlink-style feed. */
  priceFeed: Address;
  /** @deprecated alias of `stable`, kept for older code paths. */
  usdg: Address;
}

/** Filled by contracts/script/Deploy.s.sol. Empty means "not deployed on this chain". */
import local from "../deployments/31337.json" with { type: "json" };
import localBnb from "../deployments/31338.json" with { type: "json" };
import testnet from "../deployments/46630.json" with { type: "json" };
import bnbTestnet from "../deployments/97.json" with { type: "json" };

const ALL = { 31337: local, 31338: localBnb, 46630: testnet, 97: bnbTestnet } as unknown as Record<number, Record<string, unknown>>;

export function deploymentFor(chainId: number): Deployment | null {
  const d = ALL[chainId];
  if (!d || !d.escrow) return null;
  const stable = (d.stable ?? d.usdg) as Address;
  const bnb = chainId === 56 || chainId === 97 || chainId === 31338;
  return {
    ...(d as object),
    stable,
    usdg: stable,
    stableSymbol: (d.stableSymbol as string) ?? (bnb ? "USDC" : "USDG"),
    stableDecimals: Number(d.stableDecimals ?? (bnb ? 18 : 6)),
    nativeSymbol: (d.nativeSymbol as string) ?? (bnb ? "BNB" : "ETH"),
  } as Deployment;
}
