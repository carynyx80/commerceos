import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { privateKeyToAccount, type PrivateKeyAccount } from "viem/accounts";
import { chainById, deploymentFor, feeControllerAbi, merchantRegistryAbi, mockPriceFeedAbi, type Deployment } from "@commerce-os/blockchain";

import { CommerceError as AppError } from "./errors";

const config = {
  get chainId() {
    return Number(process.env.CHAIN_ID ?? 31337);
  },
  get rpcUrl() {
    return process.env.RPC_URL ?? "";
  },
  get quoteSignerKey() {
    return process.env.QUOTE_SIGNER_PRIVATE_KEY ?? "";
  },
};
export const chainConfig = config;

let client: PublicClient | null = null;
export function publicClient(): PublicClient {
  if (!client) {
    const chain = chainById(config.chainId);
    client = createPublicClient({ chain, transport: http(config.rpcUrl || chain.rpcUrls.default.http[0], { timeout: 10_000, retryCount: 2 }) }) as PublicClient;
  }
  return client;
}

export function deployment(): Deployment {
  const d = deploymentFor(config.chainId);
  if (!d) throw new AppError(503, "CONTRACTS_NOT_DEPLOYED", `Escrow contracts are not deployed on chain ${config.chainId}. Checkout is unavailable.`);
  return d;
}

let signer: PrivateKeyAccount | null = null;
export function quoteSigner(): PrivateKeyAccount {
  if (!config.quoteSignerKey) throw new AppError(503, "QUOTE_SIGNER_MISSING", "Checkout is not configured (QUOTE_SIGNER_PRIVATE_KEY missing).");
  signer ??= privateKeyToAccount(config.quoteSignerKey as `0x${string}`);
  return signer;
}

export async function merchantActiveOnChain(payout: Address): Promise<boolean> {
  return publicClient().readContract({ address: deployment().merchantRegistry, abi: merchantRegistryAbi, functionName: "isActive", args: [payout] });
}

export async function currentFeeBps(): Promise<number> {
  return Number(await publicClient().readContract({ address: deployment().feeController, abi: feeControllerAbi, functionName: "feeBps" }));
}

/** ETH/USD with 8 decimals from the configured feed. Rejects stale or invalid data. */
export async function ethUsdPrice8(maxAgeSec = 3600): Promise<bigint> {
  const d = deployment();
  const [roundId, answer, , updatedAt, answeredInRound] = await publicClient().readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "latestRoundData" });
  const decimals = await publicClient().readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "decimals" });
  const block = await publicClient().getBlock();
  if (answer <= 0n || answeredInRound < roundId || updatedAt === 0n) throw new AppError(503, "PRICE_INVALID", "ETH price feed returned invalid data. ETH checkout is paused.");
  if (block.timestamp - updatedAt > BigInt(maxAgeSec)) throw new AppError(503, "PRICE_STALE", "ETH price is stale. ETH checkout is paused until the feed updates.");
  return decimals === 8 ? answer : (answer * 10n ** 8n) / 10n ** BigInt(decimals);
}
