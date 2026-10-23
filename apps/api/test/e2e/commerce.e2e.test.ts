import { describe, expect, it, beforeAll } from "vitest";
import { erc20Abi, type Hex } from "viem";
import { commerceEscrowAbi, testUSDGAbi } from "@commerce-os/blockchain";
import { KEYS, Session, d, orderState, pub, waitFor, walletFor } from "./helpers";

/**
 * Critical journeys 1–13, 21–23 against the live local stack.
 * Run: start Postgres, Anvil (contracts deployed), API and worker, then `npm run test:e2e -w @commerce-os/api`.
 */
const buyer = new Session(KEYS.buyer);
const seller = new Session(KEYS.newSeller);
const slug = `e2e-store-${Date.now().toString(36)}`;
let productId = "";

async function pay(s: Session, quote: any) {
  const w = walletFor(s.key);
  const q = { ...quote.quote, amount: BigInt(quote.quote.amount), deadline: BigInt(quote.quote.deadline) };
  let hash: Hex;
  if (quote.asset === "USDG") {
    const ah = await w.writeContract({ address: d.usdg, abi: erc20Abi, functionName: "approve", args: [d.escrow, q.amount] });
    await pub.waitForTransactionReceipt({ hash: ah });
    hash = await w.writeContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "payWithToken", args: [q, quote.signature] });
  } else {
    hash = await w.writeContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "payWithEth", args: [q, quote.signature], value: q.amount });
  }
  await s.req(`/orders/${quote.orderId}/payment`, { json: { txHash: hash } });
  return hash;
}

async function sellerTx(fn: "accept" | "markFulfilled" | "sellerCancel", onchainId: Hex) {
  const w = walletFor(KEYS.newSeller);
  const h = await w.writeContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: fn, args: [onchainId] });
  await pub.waitForTransactionReceipt({ hash: h });
}

const bal = (a: Hex) => pub.readContract({ address: d.usdg, abi: erc20Abi, functionName: "balanceOf", args: [a] });

describe("commerce journeys", () => {
  beforeAll(async () => {
    // test-token faucet for the buyer
    const w = walletFor(KEYS.buyer);
    const h = await w.writeContract({ address: d.usdg, abi: testUSDGAbi, functionName: "faucet", args: [w.account.address, 5_000_000_000n] });
    await pub.waitForTransactionReceipt({ hash: h });
  });

  it("1–2: wallet signs in with SIWE; a replayed signature is rejected", async () => {
    const { message, signature } = await buyer.signIn();
    const me = await buyer.req("/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.address).toBe(buyer.address.toLowerCase());
    const replay = await new Session(KEYS.buyer).req("/auth/verify", { json: { message, signature } });
    expect(replay.status).toBe(401);
  });

  it("rejects writes without the CSRF token", async () => {
    const r = await fetch("http://127.0.0.1:4100/cart/items", { method: "POST", headers: { cookie: buyer.cookie, "content-type": "application/json" }, body: JSON.stringify({ productId: "x", quantity: 1 }) });
    expect(r.status).toBe(403);
  });

  it("3–4: seller creates a storefront and a product; registry sync activates the payout wallet", async () => {
    await seller.signIn();
    const s = await seller.req("/merchant/stores", { json: { name: "E2E Supply", slug, payoutAddress: seller.address, tagline: "test" } });
    expect(s.status).toBe(201);
    const p = await seller.req(`/merchant/stores/${s.body.id}/products`, {
      json: { title: `E2E Lamp ${slug}`, category: "Home", priceCents: 10_000, inventory: 5, description: "A lamp", negotiable: true, floorPriceCents: 8_500 },
    });
    expect(p.status).toBe(201);
    productId = p.body.id;
    await waitFor(() => pub.readContract({ address: d.merchantRegistry, abi: [{ type: "function", name: "isActive", inputs: [{ type: "address" }], outputs: [{ type: "bool" }], stateMutability: "view" }] as const, functionName: "isActive", args: [seller.address] }), 30_000, "registry sync");
  });

  it("5–6: buyer finds it in search and adds it to cart", async () => {
    const r = await buyer.req(`/catalog/search?q=${encodeURIComponent(slug)}`);
    expect(r.body.items.map((i: any) => i.id)).toContain(productId);
    expect(r.body.items[0]).not.toHaveProperty("floorPriceCents");
    const c = await buyer.req("/cart/items", { json: { productId, quantity: 1 } });
    expect(c.status).toBe(200);
    expect((await buyer.req("/cart")).body.lines.map((l: any) => l.productId)).toContain(productId);
  });

  it("rejects a client-supplied price", async () => {
    const r = await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG", priceCents: 1 } });
    expect(r.status).toBe(201);
    expect(r.body.totalCents).toBe(10_000); // ignored the extra field; priced by the server
  });

  it("7–12: USDG payment → escrow funded → fulfilled → confirmed → seller 98, treasury 2", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG" } })).body;
    expect(q.quote.amount).toBe("100000000");
    const sellerBefore = await bal(seller.address);
    const treasuryBefore = await bal(d.treasury);
    await pay(buyer, q);
    expect(["AWAITING_PAYMENT", "FUNDED"]).toContain(await orderState(buyer, q.orderId));
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED");
    await sellerTx("accept", q.quote.orderId);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "ACCEPTED", 30_000, "ACCEPTED");
    await sellerTx("markFulfilled", q.quote.orderId);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FULFILLED", 30_000, "FULFILLED");
    const w = walletFor(KEYS.buyer);
    const h = await w.writeContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "confirmDelivery", args: [q.quote.orderId] });
    await pub.waitForTransactionReceipt({ hash: h });
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "RELEASED", 30_000, "RELEASED");
    expect((await bal(seller.address)) - sellerBefore).toBe(98_000_000n);
    expect((await bal(d.treasury)) - treasuryBefore).toBe(2_000_000n);
    const review = await buyer.req(`/orders/${q.orderId}/review`, { json: { rating: 5, body: "Exactly as described." } });
    expect(review.status).toBe(201);
  });

  it("13: ETH payment funds the escrow", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "ETH" } })).body;
    expect(q.asset).toBe("ETH");
    expect(BigInt(q.quote.amount)).toBeGreaterThan(0n);
    await pay(buyer, q);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED (ETH)");
  });

  it("21: seller cancellation refunds the buyer in the same asset", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG" } })).body;
    await pay(buyer, q);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED");
    const before = await bal(buyer.address as Hex);
    await sellerTx("sellerCancel", q.quote.orderId);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "REFUNDED", 30_000, "REFUNDED");
    expect((await bal(buyer.address as Hex)) - before).toBe(100_000_000n);
  });

  it("23: re-submitting the same payment tx is idempotent and state stays in sync", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG" } })).body;
    const hash = await pay(buyer, q);
    await buyer.req(`/orders/${q.orderId}/payment`, { json: { txHash: hash } });
    await buyer.req(`/orders/${q.orderId}/payment`, { json: { txHash: hash } });
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED");
    const o = (await buyer.req(`/orders/${q.orderId}`)).body;
    expect(o.payments).toHaveLength(1);
    expect(o.transitions.filter((t: any) => t.to === "FUNDED")).toHaveLength(1);
    // paying the same signed quote twice is refused on-chain
    await expect(pay(buyer, q)).rejects.toThrow();
  });

  it("22: a dispute locks funds and records evidence", async () => {
    const q = (await buyer.req("/checkout/quote", { json: { productId, quantity: 1, asset: "USDG" } })).body;
    await pay(buyer, q);
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "FUNDED", 30_000, "FUNDED");
    const r = await buyer.req(`/orders/${q.orderId}/dispute`, { json: { reason: "The item never arrived after two weeks." } });
    expect(r.status).toBe(201);
    const w = walletFor(KEYS.buyer);
    const h = await w.writeContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "openDispute", args: [q.quote.orderId] });
    await pub.waitForTransactionReceipt({ hash: h });
    await waitFor(async () => (await orderState(buyer, q.orderId)) === "DISPUTED", 30_000, "DISPUTED");
    // seller can no longer cancel out of a dispute
    await expect(sellerTx("sellerCancel", q.quote.orderId)).rejects.toThrow();
  });

  it("does not oversell reserved stock", async () => {
    const r = await buyer.req("/checkout/quote", { json: { productId, quantity: 99, asset: "USDG" } });
    expect(r.status).toBe(409);
  });
});
