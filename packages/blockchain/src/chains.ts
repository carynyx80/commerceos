import { defineChain, type Chain } from "viem";
import { bsc, bscTestnet, robinhood, robinhoodTestnet } from "viem/chains";
import type { Network, PaymentAsset } from "@commerce-os/shared";
import { ASSETS } from "@commerce-os/shared";

/** Robinhood Chain mainnet (4663) / testnet (46630) and BNB Chain mainnet (56) / testnet (97), as published in viem. */
export { bsc, bscTestnet, robinhood, robinhoodTestnet };

/** Local stand-in for Robinhood Chain (ETH native). */
export const anvil = defineChain({
  id: 31337,
  name: "Local devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

/** Local stand-in for BNB Chain (BNB native), on its own Anvil instance. */
export const anvilBnb = defineChain({
  id: 31338,
  name: "Local BNB devnet",
  nativeCurrency: { name: "BNB", symbol: "BNB", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8546"] } },
  testnet: true,
});

export const CHAINS: Record<number, Chain> = {
  [robinhood.id]: robinhood,
  [robinhoodTestnet.id]: robinhoodTestnet,
  [anvil.id]: anvil,
  [bsc.id]: bsc,
  [bscTestnet.id]: bscTestnet,
  [anvilBnb.id]: anvilBnb,
};

export const NETWORK_OF_CHAIN: Record<number, Network> = { 4663: "robinhood", 46630: "robinhood", 31337: "robinhood", 56: "bnb", 97: "bnb", 31338: "bnb" };

export const MAINNET_ID = 4663;
export const MAINNET_IDS = [4663, 56] as const;
export const isMainnet = (id: number) => (MAINNET_IDS as readonly number[]).includes(id);

/** Which chain id serves each network in this deployment (from env). */
export interface NetworkConfig {
  robinhood: number | null;
  bnb: number | null;
}

/** The chain an asset settles on, or null when that network is not enabled here. */
export function chainForAsset(asset: PaymentAsset, cfg: NetworkConfig): number | null {
  return cfg[ASSETS[asset].network];
}

/** Paxos USDG on Robinhood Chain mainnet. Verified on Blockscout before any mainnet deploy (see docs/chain-verification.md). */
export const MAINNET_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;

export function chainById(id: number): Chain {
  const c = CHAINS[id];
  if (!c) throw new Error(`Commerce OS does not support chain ${id} (supported: 4663, 46630, 31337, 56, 97, 31338)`);
  return c;
}

export function explorerTx(chainId: number, hash: string): string | null {
  const url = CHAINS[chainId]?.blockExplorers?.default.url;
  return url ? `${url}/tx/${hash}` : null;
}
export function explorerAddress(chainId: number, addr: string): string | null {
  const url = CHAINS[chainId]?.blockExplorers?.default.url;
  return url ? `${url}/address/${addr}` : null;
}
