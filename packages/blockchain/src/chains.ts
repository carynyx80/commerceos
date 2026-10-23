import { defineChain, type Chain } from "viem";
import { robinhood, robinhoodTestnet } from "viem/chains";

/** Robinhood Chain mainnet (4663) and testnet (46630) as published in viem. */
export { robinhood, robinhoodTestnet };

export const anvil = defineChain({
  id: 31337,
  name: "Local devnet",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["http://127.0.0.1:8545"] } },
  testnet: true,
});

export const CHAINS: Record<number, Chain> = {
  [robinhood.id]: robinhood,
  [robinhoodTestnet.id]: robinhoodTestnet,
  [anvil.id]: anvil,
};

export const MAINNET_ID = 4663;
export const isMainnet = (id: number) => id === MAINNET_ID;

/** Paxos USDG on Robinhood Chain mainnet. Verified on Blockscout before any mainnet deploy (see docs/chain-verification.md). */
export const MAINNET_USDG = "0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168" as const;

export function chainById(id: number): Chain {
  const c = CHAINS[id];
  if (!c) throw new Error(`Commerce OS does not support chain ${id} (supported: 4663, 46630, 31337)`);
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
