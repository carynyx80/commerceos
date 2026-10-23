import { createWalletClient, http, keccak256, toHex, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chainById, merchantRegistryAbi, mockPriceFeedAbi } from "@commerce-os/blockchain";
import { deployment, enabledChains, publicClient, rpcUrlFor } from "@commerce-os/commerce";
import { audit, notify, prisma, type Job } from "@commerce-os/database";
import { indexOnce } from "./indexer";

function wallet(keyEnv: string, chainId: number) {
  const key = process.env[keyEnv];
  if (!key) throw new Error(`${keyEnv} is not configured`);
  return createWalletClient({ account: privateKeyToAccount(key as Hex), chain: chainById(chainId), transport: http(rpcUrlFor(chainId)) });
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
    const chainId = (await prisma.order.findUnique({ where: { id: orderId }, select: { chainId: true } }))?.chainId;
    if (!chainId) return;
    const receipt = await publicClient(chainId).getTransactionReceipt({ hash: txHash }).catch(() => null);
    if (!receipt) throw new Error("receipt not found yet");
    if (receipt.status === "reverted") {
      await prisma.payment.update({ where: { txHash }, data: { status: "FAILED" } });
      const o = await prisma.order.findUnique({ where: { id: orderId } });
      if (o) await notify(prisma, o.buyerId, { kind: "payment.failed", title: "Payment transaction failed", body: "The transaction reverted on-chain. No funds left your wallet except gas. You can try again before the quote expires.", href: `/orders/${orderId}` });
      log(`payment ${txHash} reverted`);
      return;
    }
    await indexOnce(chainId, log);
  },

  /** Register or update a store's payout wallet in the MerchantRegistry on every enabled chain. */
  async "registry.sync"(job, log) {
    const { storeId } = job.payload as { storeId: string };
    const s = await prisma.store.findUnique({ where: { id: storeId }, include: { merchant: true } });
    if (!s) return;
    for (const chainId of enabledChains()) {
      const d = deployment(chainId);
      const c = publicClient(chainId);
      const want = { active: s.active, verified: s.merchant.verified };
      const cur = await c.readContract({ address: d.merchantRegistry, abi: merchantRegistryAbi, functionName: "merchants", args: [s.payoutAddress as Hex] });
      if (cur[1] === want.active && cur[2] === want.verified) continue; // already in sync: no transaction
      const w = wallet("REGISTRAR_PRIVATE_KEY", chainId);
      const hash = await withSigner(`registrar:${chainId}`, () => w.writeContract({
        address: d.merchantRegistry,
        abi: merchantRegistryAbi,
        functionName: "setMerchant",
        args: [s.payoutAddress as Hex, keccak256(toHex(`commerce-os:merchant:${s.merchantId}`)), s.active, s.merchant.verified],
      }));
      const r = await c.waitForTransactionReceipt({ hash, timeout: 60_000 });
      if (r.status !== "success") throw new Error(`registry tx reverted on chain ${chainId} (${hash})`);
      await audit(prisma, { actorType: "system", action: "registry.sync", target: storeId, data: { chainId, hash, active: s.active } });
      log(`registry synced for ${s.slug} on chain ${chainId} (${hash})`);
    }
  },
};

/** Local devnets only: keep the mock native/USD feeds fresh so ETH and BNB checkout can be exercised. */
export async function refreshDevPriceFeed(log: (m: string) => void) {
  const key = process.env.DEV_FEED_ADMIN_KEY;
  if (!key) return;
  for (const chainId of enabledChains().filter((id) => id === 31337 || id === 31338)) {
    const d = deployment(chainId);
    const c = publicClient(chainId);
    const [, answer, , updatedAt] = await c.readContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "latestRoundData" });
    // Anvil's clock only moves when a block is mined, so after idle time the next block can jump
    // far ahead. Judge freshness against wall-clock time so the test feed never lapses between blocks.
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (now - updatedAt < 600n) continue;
    const w = createWalletClient({ account: privateKeyToAccount(key as Hex), chain: chainById(chainId), transport: http(rpcUrlFor(chainId)) });
    // Mine an empty block first (local devnet only) so the chain clock catches up to wall time;
    // a feed timestamp ahead of block.timestamp would make the policy contract underflow.
    await c.request({ method: "evm_mine" as never, params: [] as never });
    const block = await c.getBlock();
    await w.writeContract({ address: d.priceFeed, abi: mockPriceFeedAbi, functionName: "set", args: [answer, block.timestamp] });
    log(`refreshed local devnet ${d.nativeSymbol}/USD test feed on chain ${chainId}`);
  }
}
