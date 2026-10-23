import { beforeAll, describe, expect, it } from "vitest";
import { createPublicClient, createWalletClient, erc20Abi, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvilBnb, commerceEscrowAbi, deploymentFor, testStableAbi } from "@commerce-os/blockchain";
import { KEYS, Session, orderState, waitFor } from "./helpers";

/**
 * USDC and BNB on BNB Chain (local devnet 31338), against the live stack. BNB Chain USDC has
 * 18 decimals, so these also prove amounts are scaled per chain rather than assumed to be 6.
 */
const bnb = deploymentFor(31338)!;
const pub = createPublicClient({ chain: anvilBnb, transport: http("http://127.0.0.1:8546") });
const walletFor = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: anvilBnb, transport: http("http://127.0.0.1:8546") });
const buyer = new Session(KEYS.buyer);
const seller = new Session(KEYS.newSeller);
const slug = `bnb-store-${Date.now().toString(36)}`;
let productId = "";

const usdcBal = (a: Hex) => pub.readContract({ address: bnb.stable, abi: erc20Abi, functionName: "balanceOf", args: [a] });

async function pay(q: any) {
  const w = walletFor(buyer.key);
  const quote = { ...q.quote, amount: BigInt(q.quote.amount), deadline: BigInt(q.quote.deadline) };
  let hash: Hex;
  if (q.asset === "USDC") {
    const ah = await w.writeContract({ address: q.stable, abi: erc20Abi, functionName: "approve", args: [q.escrow, quote.amount] });
    await pub.waitForTransactionReceipt({ hash: ah });
    hash = await w.writeContract({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithToken", args: [quote, q.signature] });
  } else {
    hash = await w.writeContract({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithEth", args: [quote, q.signature], value: quote.amount });
  }
  await buyer.req(`/orders/${q.orderId}/payment`, { json: { txHash: hash } });
}

async function sellerTx(fn: "accept" | "markFulfilled", id: Hex) {
  const h = await walletFor(KEYS.newSeller).writeContract({ address: bnb.escrow, abi: commerceEscrowAbi, functionName: fn, args: [id] });
  await pub.waitForTransactionReceipt({ hash: h });
}

describe("BNB Chain: USDC and BNB", () => {
  beforeAll(async () => {
    expect(bnb.stableDecimals).toBe(18);
    const w = walletFor(KEYS.buyer);
    const h = await w.writeContract({ address: bnb.stable, abi: testStableAbi, functionName: "faucet", args: [w.account.address, 5_000n * 10n ** 18n] });
    await pub.waitForTransactionReceipt({ hash: h });
    await buyer.signIn();
    await seller.signIn();
    const s = await seller.req("/merchant/stores", { json: { name: "BNB Goods", slug, payoutAddress: seller.address } });
    expect(s.status).toBe(201);
    const p = await seller.req(`/merchant/stores/${s.body.id}/products`, { json: { title: `BNB Lamp ${slug}`, category: "Home", priceCents: 10_000, inventory: 5, acceptedAssets: ["USDC", "BNB"] } });
    expect(p.status).toBe(201);
    productId = p.body.id;
    // payout wallet must be registered on BNB Chain too
    const reg = [{ type: "function", name: "isActive", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" }] as const;
    await waitFor(() => pub.readContract({ address: bnb.merchantRegistry, abi: reg, functionName: "isActive", args: [seller.address] }), 40_000, "BNB registry sync");
  });

  it("refuses an asset the listing does not accept", async () => {
    const r = await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG" } });
    expect(r.status).toBe(400);
    expect(r.body.code).toBe("ASSET_NOT_ACCEPTED");
  });

  it("USDC (18 decimals): quote on chain 31338 → funded → settled 98 / 2", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDC" } })).body;
    expect(q.chainId).toBe(31338);
    expect(q.stableDecimals).toBe(18);
    expect(q.quote.amount).toBe((100n * 10n ** 18n).toString()); // $100.00 as 18-decimal USDC
    const sBefore = await usdcBal(seller.address);
    const tBefore = await usdcBal(bnb.treasury);
    await pay(q);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED (USDC)");
    const o = (await buyer.req(`/orders/${q.orderId}`)).body;
    expect(o.chainId).toBe(31338);
    expect(o.payments[0].chainId).toBe(31338);
    await sellerTx("accept", q.quote.orderId);
    await sellerTx("markFulfilled", q.quote.orderId);
    const h = await walletFor(KEYS.buyer).writeContract({ address: bnb.escrow, abi: commerceEscrowAbi, functionName: "confirmDelivery", args: [q.quote.orderId] });
    await pub.waitForTransactionReceipt({ hash: h });
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "RELEASED", 30_000, "RELEASED (USDC)");
    expect((await usdcBal(seller.address)) - sBefore).toBe(98n * 10n ** 18n);
    expect((await usdcBal(bnb.treasury)) - tBefore).toBe(2n * 10n ** 18n);
  });

  it("BNB: priced from the BNB/USD feed, funds the BNB Chain escrow", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "BNB" } })).body;
    expect(q.chainId, JSON.stringify(q)).toBe(31338);
    expect(q.nativeSymbol).toBe("BNB");
    // $100 at the feed price, rounded up
    const price8 = BigInt(q.nativeUsdPrice8);
    const expected = (10_000n * 10n ** 24n + price8 - 1n) / price8;
    expect(BigInt(q.quote.amount)).toBe(expected);
    await pay(q);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED (BNB)");
  });

  it("a BNB Chain quote cannot be paid on Robinhood Chain (signature is chain-bound)", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDC" } })).body;
    const { anvil } = await import("@commerce-os/blockchain");
    const rh = createPublicClient({ chain: anvil, transport: http("http://127.0.0.1:8545") });
    const quote = { ...q.quote, amount: BigInt(q.quote.amount), deadline: BigInt(q.quote.deadline) };
    await expect(
      rh.simulateContract({ account: privateKeyToAccount(KEYS.buyer), address: deploymentFor(31337)!.escrow, abi: commerceEscrowAbi, functionName: "payWithToken", args: [quote, q.signature] }),
    ).rejects.toThrow();
  });
});
