import { createWalletClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, merchantRegistryAbi, mockPriceFeedAbi } from "@commerce-os/blockchain";
import { chainConfig, deployment, publicClient } from "@commerce-os/commerce";
import { audit, notify, prisma, type Job } from "@commerce-os/database";
import { indexOnce } from "./indexer";

function wallet(keyEnv: string) {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`${keyEnv} is not configured`);
  const chain = chainById(chainConfig.chainId);
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(chainConfig.rpcUrl || chain.rpcUrls.default.http[0]) });
}

/** One in-flight transaction per signing key, so concurrent jobs never race on the nonce. */
const locks = new Map<string, Promise<unknown>>();
export async function withSigner<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  locks.set(key, run);
  try {
    return await run;
  } finally {
    if (locks.get(key) === run) locks.delete(key);
  }
}

type Handler = (job: Job, log: (m: string) => void) => Promise<void>;

export const handlers: Record<string, Handler> = {
  /** Watch a submitted payment. Never marks the order paid itself; the indexer does that from events. */
  async "payment.verify"(job, log) {
    const { orderId, txHash } = job.payload as { orderId: string; txHash: Hex };
    const receipt = await publicClient().getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) throw new Error("receipt not found yet");
    if (receipt.status === "reverted") {
      await prisma.payment.update({ where: { txHash }, data: { status: "FAILED" } });
      const o = await prisma.order.findUnique({ where: { id: orderId } });
      if (o) await notify(prisma, o.buyerId, { kind: "payment.failed", title: "Payment transaction failed", body: "The transaction reverted on-chain. No funds left your wallet except gas. You can try again before the quote expires.", href: `/orders/${orderId}` });
      log(`payment ${txHash} reverted`);
      return;
    }
    await indexOnce(log);
  },

  /** Register or update a store's payout wallet in the on-chain MerchantRegistry. */
  async "registry.sync"(job, log) {
    const { storeId } = job.payload as { storeId: string };
    const s = await prisma.store.findUnique({ where: { id: storeId }, include: { merchant: true } });
    if (!s) return;
    const w = wallet("REGISTRAR_PRIVATE_KEY");
    const d = deployment();
    const hash = await withSigner("registrar", () => w.writeContract({
      address: d.merchantRegistry,
      abi: merchantRegistryAbi,
      functionName: "setMerchant",
      args: [s.payoutAddress as Hex, keccak256(toHex(`commerce-os:merchant:${s.merchantId}`)), s.active, s.merchant.verified],
    }));
    const r = await publicClient().waitForTransactionReceipt({ hash, timeout: 60_000 });
    if (r.status !== "success") throw new Error(`registry tx reverted ${hash}`);
    await audit(prisma, { actorType: "system", action: "registry.sync", target: storeId, data: { hash, active: s.active } });
    log(`registry synced for ${s.slug} (${hash})`);
  },
};

/** Local devnet only: keep the mock ETH/USD feed fresh so ETH checkout can be exercised. */
export async function refreshDevPriceFeed(log: (m: string) => void) {
  if (chainConfig.chainId !== 31337) return;
  const d = deployment();
  const [, answer, , updatedAt] = await publicClient().readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "latestRoundData" });
  const block = await publicClient().getBlock();
  if (block.timestamp - updatedAt < 1800n) return;
  const key = process.env.DEV_FEED_ADMIN_KEY;
  if (!key) return;
  const chain = chainById(31337);
  const w = createWalletClient({ account: privateKeyToAccount(key as Hex), chain, transport: http(chainConfig.rpcUrl) });
  await w.writeContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "set", args: [answer, block.timestamp] });
  log("refreshed local devnet ETH/USD test feed");
}
