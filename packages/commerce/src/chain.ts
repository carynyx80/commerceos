import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainById, chainForAsset, deploymentFor, feeControllerAbi, merchantRegistryAbi, mockPriceFeedAbi, type Deployment, type NetworkConfig } from "@commerce-os/blockchain";
import { ASSETS, NETWORK_LABEL, type PaymentAsset } from "@commerce-os/shared";

import { CommerceError as AppError } from "./errors";

/**
 * Chains this deployment settles on. CHAIN_ID is the Robinhood-family chain (USDG + ETH);
 * BNB_CHAIN_ID, when set, enables BNB Chain (USDC + BNB). Each has its own RPC.
 */
const config = {
  get chainId() {
    return Number(process.env.CHAIN_ID ?? 31337);
  },
  get bnbChainId(): number | null {
    return process.env.BNB_CHAIN_ID ? Number(process.env.BNB_CHAIN_ID) : null;
  },
  get rpcUrl() {
    return process.env.RPC_URL ?? "";
  },
  get quoteSignerKey() {
    return process.env.QUOTE_SIGNER_PRIVATE_KEY ?? "";
  },
};
export const chainConfig = config;

export function networkConfig(): NetworkConfig {
  return { robinhood: config.chainId, bnb: config.bnbChainId };
}

/** Every chain this deployment indexes and accepts payments on. */
export function enabledChains(): number[] {
  return [config.chainId, ...(config.bnbChainId ? [config.bnbChainId] : [])];
}

function rpcFor(chainId: number): string {
  if (chainId === config.chainId && config.rpcUrl) return config.rpcUrl;
  if (chainId === config.bnbChainId && process.env.BNB_RPC_URL) return process.env.BNB_RPC_URL;
  return chainById(chainId).rpcUrls.default.http[0];
}
export const rpcUrlFor = rpcFor;

const clients = new Map<number, PublicClient>();
export function publicClient(chainId: number = config.chainId): PublicClient {
  let c = clients.get(chainId);
  if (!c) {
    c = createPublicClient({ chain: chainById(chainId), transport: http(rpcFor(chainId), { timeout: 10_000, retryCount: 2 }) }) as PublicClient;
    clients.set(chainId, c);
  }
  return c;
}

export function deployment(chainId: number = config.chainId): Deployment {
  const d = deploymentFor(chainId);
  if (!d) throw new AppError(503, "CONTRACTS_NOT_DEPLOYED", `Escrow contracts are not deployed on chain ${chainId}. Checkout on that network is unavailable.`);
  return d;
}

/** The chain an asset settles on here, or a clear error when its network is not enabled. */
export function chainIdForAsset(asset: PaymentAsset): number {
  const id = chainForAsset(asset, networkConfig());
  if (!id) throw new AppError(400, "NETWORK_DISABLED", `${asset} settles on ${NETWORK_LABEL[ASSETS[asset].network]}, which is not enabled on this deployment.`);
  return id;
}

let signer: PrivateKeyAccount | null = null;
export function quoteSigner(): PrivateKeyAccount {
  if (!config.quoteSignerKey) throw new AppError(503, "QUOTE_SIGNER_MISSING", "Checkout is not configured (QUOTE_SIGNER_PRIVATE_KEY missing).");
  signer ??= privateKeyToAccount(config.quoteSignerKey as `0x${string}`);
  return signer;
}

export async function merchantActiveOnChain(payout: Address, chainId: number = config.chainId): Promise<boolean> {
  return publicClient(chainId).readContract({ address: deployment(chainId).merchantRegistry, abi: merchantRegistryAbi, functionName: "isActive", args: [payout] });
}

export async function currentFeeBps(chainId: number = config.chainId): Promise<number> {
  return Number(await publicClient(chainId).readContract({ address: deployment(chainId).feeController, abi: feeControllerAbi, functionName: "feeBps" }));
}

/** Native/USD (ETH or BNB) with 8 decimals from the chain's feed. Rejects stale or invalid data. */
export async function nativeUsdPrice8(chainId: number = config.chainId, maxAgeSec = 3600): Promise<bigint> {
  const d = deployment(chainId);
  const c = publicClient(chainId);
  const sym = d.nativeSymbol;
  const [roundId, answer, , updatedAt, answeredInRound] = await c.readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "latestRoundData" });
  const decimals = await c.readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "decimals" });
  const block = await c.getBlock();
  if (answer <= 0n || answeredInRound < roundId || updatedAt === 0n) throw new AppError(503, "PRICE_INVALID", `${sym} price feed returned invalid data. ${sym} checkout is paused.`);
  if (block.timestamp - updatedAt > BigInt(maxAgeSec)) throw new AppError(503, "PRICE_STALE", `${sym} price is stale. ${sym} checkout is paused until the feed updates.`);
  return decimals === 8 ? answer : (answer * 10n ** 8n) / 10n ** BigInt(decimals);
}

/** @deprecated use nativeUsdPrice8 */
export const ethUsdPrice8 = (maxAgeSec = 3600) => nativeUsdPrice8(config.chainId, maxAgeSec);
