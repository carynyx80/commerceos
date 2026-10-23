import type { Address } from "viem";

export interface Deployment {
  chainId: number;
  deployedAtBlock: number;
  /** True when USDG is the labelled no-value test token, not Paxos USDG. */
  testToken: boolean;
  usdg: Address;
  escrow: Address;
  merchantRegistry: Address;
  feeController: Address;
  treasury: Address;
  disputeResolver: Address;
  policyModule: Address;
  accountFactory: Address;
  priceFeed: Address;
}

/** Filled by contracts/script/Deploy.s.sol via scripts/sync-deployments. Empty means "not deployed on this chain". */
import local from "../deployments/31337.json" with { type: "json" };
import testnet from "../deployments/46630.json" with { type: "json" };

const ALL = { 31337: local, 46630: testnet } as unknown as Record<number, Partial<Deployment>>;

export function deploymentFor(chainId: number): Deployment | null {
  const d = ALL[chainId];
  return d && d.escrow ? (d as Deployment) : null;
}
