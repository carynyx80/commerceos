import { beforeAll, describe, expect, it } from "vitest";
import { erc20Abi, type Hex } from "viem";
import { agentAccountAbi, agentAccountFactoryAbi, agentPolicyModuleAbi, testUSDGAbi } from "@commerce-os/blockchain";
import { runTool, executeAgentPayment, PaymentRefused } from "@commerce-os/agent-core";
import { cancelUnpaidOrder, createCheckoutQuote } from "@commerce-os/commerce";
import { prisma } from "@commerce-os/database";
import { KEYS, Session, d, pub, waitFor, walletFor } from "./helpers";

/**
 * Critical journeys 14–20. The agent's tools are exercised directly (the same functions the
 * LLM calls), so these run without an OpenAI key. Seller-agent replies and agent payments go
 * through the real worker and the local chain.
 */
const owner = new Session(KEYS.buyer2);
let agentId = "";
const SALT = BigInt(Date.now()); // fresh account per run: on-chain spend windows persist
let account: Hex;
let daypackId = "";
let fieldworkStoreId = "";
let fieldworkPayout: Hex;

const ctx = async () => ({ userId: (await owner.req("/auth/me")).body.id as string, agent: await prisma.agent.findUnique({ where: { id: agentId }, include: { policy: true } }) });

async function send(fn: () => Promise<Hex>) {
  const h = await fn();
  const r = await pub.waitForTransactionReceipt({ hash: h });
  expect(r.status).toBe("success");
}

describe("agent journeys", () => {
  beforeAll(async () => {
    await owner.signIn();
    const p = await prisma.product.findFirstOrThrow({ where: { title: { startsWith: "Daypack" } }, include: { store: true } });
    daypackId = p.id;
    fieldworkStoreId = p.storeId;
    fieldworkPayout = p.store.payoutAddress as Hex;
    // clear earlier runs' open negotiations so the seller agent starts fresh
    const me = (await owner.req("/auth/me")).body;
    await prisma.negotiation.updateMany({ where: { buyerId: me.id, status: { in: ["OPEN", "ACCEPTED"] } }, data: { status: "CANCELLED" } });
    for (const o of await prisma.order.findMany({ where: { buyerId: me.id, state: "AWAITING_PAYMENT" } })) await cancelUnpaidOrder(o.id, "api");
  });

  it("14: owner creates a buyer agent with a spending policy", async () => {
    const r = await owner.req("/agents", {
      json: {
        name: "E2E scout",
        type: "BUYER",
        preferences: "verified sellers",
        policy: { maxPerOrderCents: 11_000, rollingLimitCents: 30_000, rollingWindowDays: 30, allowedAssets: ["USDG"], approvedStoreIds: [fieldworkStoreId], approvedCategories: [], expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), maxDiscountAskBps: 2000, maxNegotiationRounds: 4, automationEnabled: false },
      },
    });
    expect(r.status).toBe(201);
    agentId = r.body.id;
  });

  it("15: agent searches real listings", async () => {
    const out: any = await runTool("search_products", { query: "daypack", maxPriceUsd: 200 }, await ctx());
    expect(out.products.map((p: any) => p.productId)).toContain(daypackId);
    expect(out.products[0]).not.toHaveProperty("floorPriceCents");
  });

  it("16: agent negotiates with the seller agent", async () => {
    const c = await ctx();
    const n: any = await runTool("start_negotiation", { productId: daypackId, quantity: 1, asset: "USDG" }, c);
    const tooLow: any = await runTool("make_offer", { negotiationId: n.negotiationId, priceUsd: 90 }, c);
    expect(tooLow.error).toBe("DISCOUNT_TOO_DEEP"); // buyer-side limit: at most 20% off
    const unitSlip: any = await runTool("make_offer", { negotiationId: n.negotiationId, priceUsd: 1.1 }, c);
    expect(unitSlip.error).toBe("OFFER_TOO_LOW"); // a cents-for-dollars mistake is refused, never sent
    await runTool("make_offer", { negotiationId: n.negotiationId, priceUsd: 100, message: "Would you take $100?" }, c);
    let view: any = await runTool("check_negotiation", { negotiationId: n.negotiationId }, c);
    let counter = view.offers.at(-1);
    expect(counter.from).toBe("SELLER");
    expect(counter.byAgent).toBe(true);
    expect(counter.price.usd * 100).toBeGreaterThanOrEqual(10_500); // never below the merchant floor
    // $113 is over the agent's $110 per-order cap: the agent may not accept it.
    const refused: any = await runTool("accept_counter", { negotiationId: n.negotiationId }, c);
    expect(refused.error).toBe("OVER_LIMIT");
    // Keep offering at the cap until the seller agent accepts (it concedes in late rounds, never below floor).
    for (let i = 0; i < 4 && view.status === "OPEN"; i++) {
      await runTool("make_offer", { negotiationId: n.negotiationId, priceUsd: 110 }, c);
      view = await runTool("check_negotiation", { negotiationId: n.negotiationId }, c);
      counter = view.offers.at(-1);
      if (view.status === "OPEN" && counter.from === "SELLER" && counter.price.usd * 100 <= 11_000) {
        await runTool("accept_counter", { negotiationId: n.negotiationId }, c);
        view = await runTool("check_negotiation", { negotiationId: n.negotiationId }, c);
      }
    }
    expect(view.status).toBe("ACCEPTED");
    expect(view.agreedPrice?.usd * 100).toBeLessThanOrEqual(11_000);
    expect(view.agreedPrice?.usd * 100).toBeGreaterThanOrEqual(10_500);
    (globalThis as any).negotiationId = n.negotiationId;
  });

  it("17 (manual): without a smart account the agent hands checkout to the user", async () => {
    const out: any = await runTool("prepare_checkout", { productId: daypackId, quantity: 1, asset: "USDG", negotiationId: (globalThis as any).negotiationId }, await ctx());
    expect(out.mode).toBe("USER_APPROVAL_REQUIRED");
    expect(out.checkoutLink).toContain("/checkout?product=");
  });

  it("owner deploys, authorizes, funds and links the agent's smart account", async () => {
    const w = walletFor(KEYS.buyer2);
    const cfg = (await owner.req("/agents/config")).body;
    account = (await pub.readContract({ address: d.accountFactory, abi: agentAccountFactoryAbi, functionName: "accountAddress", args: [w.account.address, SALT] })) as Hex;
    await send(() => w.writeContract({ address: d.accountFactory, abi: agentAccountFactoryAbi, functionName: "createAccount", args: [SALT] }));
    await send(() => w.writeContract({ address: account, abi: agentAccountAbi, functionName: "setAgentKey", args: [cfg.executor] }));
    const now = Number((await pub.getBlock()).timestamp);
    await send(() =>
      w.writeContract({
        address: d.policyModule,
        abi: agentPolicyModuleAbi,
        functionName: "setPolicy",
        args: [account, { maxPerOrderUsd: 110_000_000n, rollingLimitUsd: 300_000_000n, window: 30 * 86400, expiresAt: now + 7 * 86400, allowedAssets: 1, merchantAllowlist: true, revoked: false, nonce: 0n }],
      }),
    );
    await send(() => w.writeContract({ address: d.policyModule, abi: agentPolicyModuleAbi, functionName: "setMerchant", args: [account, fieldworkPayout, true] }));
    await send(() => w.writeContract({ address: d.usdg, abi: testUSDGAbi, functionName: "faucet", args: [account, 500_000_000n] }));
    const link = await owner.req(`/agents/${agentId}/account`, { json: { accountAddress: account } });
    expect(link.status).toBe(200);
    const p = await owner.req(`/agents/${agentId}`, {
      method: "PATCH",
      json: { policy: { maxPerOrderCents: 11_000, rollingLimitCents: 30_000, rollingWindowDays: 30, allowedAssets: ["USDG"], approvedStoreIds: [fieldworkStoreId], approvedCategories: [], expiresAt: new Date(Date.now() + 7 * 86400_000).toISOString(), maxDiscountAskBps: 2000, maxNegotiationRounds: 4, automationEnabled: true } },
    });
    expect(p.status).toBe(200);
  });

  it("17–18: agent prepares the accepted checkout and completes an authorized purchase", async () => {
    // a new negotiation (the earlier accepted price may have been superseded)
    const c = await ctx();
    const prep: any = await runTool("prepare_checkout", { productId: daypackId, quantity: 1, asset: "USDG", negotiationId: (globalThis as any).negotiationId }, c);
    expect(prep.mode).toBe("AGENT_PAYABLE");
    const before = await pub.readContract({ address: d.usdg, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    const exec: any = await runTool("execute_purchase", { orderId: prep.orderId }, c);
    expect(exec, JSON.stringify(exec)).toMatchObject({ state: "FUNDED" });
    const after = await pub.readContract({ address: d.usdg, abi: erc20Abi, functionName: "balanceOf", args: [account] });
    expect(before - after).toBe(BigInt(Math.round(prep.total.usd * 100)) * 10_000n);
    const o = await prisma.order.findUniqueOrThrow({ where: { id: prep.orderId } });
    expect(o.buyerAddress).toBe(account.toLowerCase());
    expect(o.agentId).toBe(agentId);
  });

  it("19: unauthorized spending is rejected — off-chain and by the policy contract", async () => {
    const c = await ctx();
    // Over the per-order limit: the agent must hand it to the user.
    const watch = await prisma.product.findFirstOrThrow({ where: { title: { startsWith: "Suede derby" } } });
    const prep: any = await runTool("prepare_checkout", { productId: watch.id, quantity: 1, asset: "USDG" }, c);
    expect(prep.mode).toBe("USER_APPROVAL_REQUIRED");
    expect(prep.reason).toMatch(/per-order limit/);

    // Simulate an off-chain bug: the database policy is loosened but the contract is not.
    await prisma.agentPolicy.update({ where: { agentId }, data: { maxPerOrderCents: 100_000, rollingLimitCents: 1_000_000 } });
    const q = await createCheckoutQuote({ buyerId: c.userId, payerAddress: account, productId: watch.id, quantity: 1, asset: "USDG", agentId });
    await expect(executeAgentPayment(q.orderId, agentId)).rejects.toThrow(/OverPerOrderLimit/);
    await prisma.agentPolicy.update({ where: { agentId }, data: { maxPerOrderCents: 11_000, rollingLimitCents: 30_000 } });
    expect((await prisma.order.findUniqueOrThrow({ where: { id: q.orderId } })).state).toBe("AWAITING_PAYMENT");
    await cancelUnpaidOrder(q.orderId, "api"); // release it from the window and return its stock
  });

  it("20: revoked authorization prevents further purchases", async () => {
    const c = await ctx();
    const tote = await prisma.product.findFirstOrThrow({ where: { title: { startsWith: "Canvas market tote" } } });
    const q = await createCheckoutQuote({ buyerId: c.userId, payerAddress: account, productId: tote.id, quantity: 1, asset: "USDG", agentId });
    // on-chain revocation by the owner
    const w = walletFor(KEYS.buyer2);
    await send(() => w.writeContract({ address: d.policyModule, abi: agentPolicyModuleAbi, functionName: "revoke", args: [account] }));
    await expect(executeAgentPayment(q.orderId, agentId)).rejects.toThrow(/Revoked/);
    // and in Commerce OS
    const r = await owner.req(`/agents/${agentId}/revoke`, { json: {} });
    expect(r.status).toBe(200);
    await expect(executeAgentPayment(q.orderId, agentId)).rejects.toThrow(PaymentRefused);
    const t: any = await runTool("prepare_checkout", { productId: tote.id, quantity: 1, asset: "USDG" }, await ctx());
    expect(t.mode).toBe("USER_APPROVAL_REQUIRED");
    await cancelUnpaidOrder(q.orderId, "api");
  });
});
