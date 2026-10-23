import { z } from "zod";
import { prisma, enqueueJob, type Agent, type AgentPolicy } from "@commerce-os/database";
import { acceptOffer, chainIdForAsset, checkSpendingPolicy, createCheckoutQuote, getNegotiation, openNegotiation, rejectNegotiation, submitOffer, CommerceError } from "@commerce-os/commerce";
import { formatUsd } from "@commerce-os/shared";

/**
 * Agent tools. Each one validates its arguments, runs against real marketplace data, and
 * returns plain JSON. Every live price, rating, stock count and outcome the agent reports
 * must come from these results. Text from listings and merchants is returned inside
 * `untrusted` fields so the model treats it as data, never as instructions.
 */
export interface ToolContext {
  userId: string;
  agent: (Agent & { policy: AgentPolicy | null }) | null;
  /** Called with a short UI label as each tool starts (drives the workspace activity states). */
  onStep?: (label: string) => Promise<void> | void;
}

/** Every amount the model sees or sends is in US dollars; cents stay inside the server. */
const money = (c: number) => ({ usd: c / 100, display: formatUsd(c) });
const usd = z.number().positive().max(1_000_000).describe("US dollars, e.g. 449.99");
const toCents = (d: number) => Math.round(d * 100);
const policyView = (p: Awaited<ReturnType<typeof checkSpendingPolicy>>) => ({
  allowed: p.allowed,
  reasons: p.reasons,
  maxPerOrder: money(p.maxPerOrderCents),
  spentInWindow: money(p.spentInWindowCents),
  remainingInWindow: money(p.remainingCents),
  expiresAt: p.expiresAt,
});
function negotiationView(n: Awaited<ReturnType<typeof getNegotiation>>) {
  return {
    negotiationId: n.id,
    status: n.status,
    productId: n.productId,
    product: n.productTitle,
    store: n.storeName,
    listPrice: money(n.listPriceCents),
    agreedPrice: n.agreedCents != null ? money(n.agreedCents) : null,
    quantity: n.quantity,
    asset: n.asset,
    rounds: n.rounds,
    expiresAt: n.expiresAt,
    sellerAgentActive: n.sellerAgentActive,
    offers: n.offers.map((o) => ({ from: o.from, price: money(o.priceCents), status: o.status, byAgent: o.byAgent, expiresAt: o.expiresAt, untrusted: { message: o.message } })),
  };
}

export const toolDefs = {
  search_products: {
    label: "Searching marketplace",
    description: "Search live marketplace listings. Returns only ACTIVE listings with current price and stock.",
    schema: z.object({
      query: z.string().max(200).describe("Keywords, e.g. 'laptop 16GB'"),
      category: z.string().max(40).optional(),
      maxPriceUsd: usd.optional(),
      minPriceUsd: z.number().min(0).max(1_000_000).optional().describe("US dollars"),
      asset: z.enum(["USDG", "ETH", "USDC", "BNB"]).optional().describe("USDG/ETH settle on Robinhood Chain; USDC/BNB on BNB Chain"),
      negotiableOnly: z.boolean().optional(),
    }),
  },
  get_product: {
    label: "Retrieving specifications",
    description: "Full details for one product: specs, stock, shipping, return policy and verified reviews.",
    schema: z.object({ productId: z.string() }),
  },
  get_seller: {
    label: "Checking seller",
    description: "Seller reputation from settled orders and verified reviews.",
    schema: z.object({ storeId: z.string() }),
  },
  compare_products: {
    label: "Comparing listings",
    description: "Side-by-side comparison of up to 6 products: price, stock, seller verification and rating.",
    schema: z.object({ productIds: z.array(z.string()).min(2).max(6) }),
  },
  check_spending_policy: {
    label: "Validating spending policy",
    description: "Check whether a purchase fits the agent's spending policy. Deterministic; the model cannot override it.",
    schema: z.object({ totalUsd: usd, storeId: z.string(), asset: z.enum(["USDG", "ETH", "USDC", "BNB"]) }),
  },
  start_negotiation: {
    label: "Opening negotiation",
    description: "Open a negotiation on a negotiable listing.",
    schema: z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10).default(1), asset: z.enum(["USDG", "ETH", "USDC", "BNB"]).default("USDG") }),
  },
  make_offer: {
    label: "Preparing offer",
    description: "Submit a buyer offer (or counter) per unit, in US dollars (e.g. 450 means $450.00). Returns the seller's reply when it arrives.",
    schema: z.object({ negotiationId: z.string(), priceUsd: usd, message: z.string().max(400).optional() }),
  },
  check_negotiation: {
    label: "Waiting for seller response",
    description: "Current status and offer history of a negotiation.",
    schema: z.object({ negotiationId: z.string() }),
  },
  accept_counter: {
    label: "Accepting counteroffer",
    description: "Accept the seller's latest pending counteroffer.",
    schema: z.object({ negotiationId: z.string() }),
  },
  withdraw_negotiation: {
    label: "Withdrawing",
    description: "Withdraw from a negotiation.",
    schema: z.object({ negotiationId: z.string() }),
  },
  prepare_checkout: {
    label: "Preparing payment",
    description:
      "Create a server-signed checkout quote. If the agent has autonomous payments enabled and the purchase passes policy, the quote is payable by the agent's smart account; otherwise the user pays from their wallet.",
    schema: z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10).default(1), asset: z.enum(["USDG", "ETH", "USDC", "BNB"]), negotiationId: z.string().optional() }),
  },
  execute_purchase: {
    label: "Awaiting blockchain confirmation",
    description: "Pay a prepared agent checkout from the agent's smart account. The policy contract makes the final decision.",
    schema: z.object({ orderId: z.string() }),
  },
  track_orders: {
    label: "Tracking orders",
    description: "The user's recent orders with their escrow state.",
    schema: z.object({ limit: z.number().int().min(1).max(20).default(10) }),
  },
} as const;

export type ToolName = keyof typeof toolDefs;

export async function runTool(name: ToolName, rawArgs: unknown, ctx: ToolContext): Promise<unknown> {
  const def = toolDefs[name];
  if (!def) throw new Error(`unknown tool ${name}`);
  const args = def.schema.parse(rawArgs) as any;
  await ctx.onStep?.(def.label);
  try {
    return await impl[name](args, ctx);
  } catch (e) {
    if (e instanceof CommerceError) return { error: e.code, message: e.message };
    throw e;
  }
}

const impl: Record<ToolName, (args: any, ctx: ToolContext) => Promise<unknown>> = {
  async search_products(a) {
    const terms = String(a.query).split(/\s+/).filter((t: string) => t.length > 1).slice(0, 6);
    const rows = await prisma.product.findMany({
      where: {
        status: "ACTIVE",
        store: { active: true },
        AND: [
          ...terms.map((t: string) => ({ OR: [{ title: { contains: t, mode: "insensitive" as const } }, { description: { contains: t, mode: "insensitive" as const } }, { category: { contains: t, mode: "insensitive" as const } }] })),
          ...(a.category ? [{ category: { equals: a.category, mode: "insensitive" as const } }] : []),
          ...(a.maxPriceUsd ? [{ priceCents: { lte: toCents(a.maxPriceUsd) } }] : []),
          ...(a.minPriceUsd ? [{ priceCents: { gte: toCents(a.minPriceUsd) } }] : []),
          ...(a.asset ? [{ acceptedAssets: { has: a.asset } }] : []),
          ...(a.negotiableOnly ? [{ negotiable: true }] : []),
        ],
      },
      include: { inventory: true, store: { include: { merchant: true } } },
      take: 10,
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
    });
    // Broaden to any term if the strict AND found nothing.
    const results = rows.length || terms.length < 2 ? rows : await prisma.product.findMany({
      where: { status: "ACTIVE", store: { active: true }, OR: terms.map((t: string) => ({ title: { contains: t, mode: "insensitive" as const } })), ...(a.maxPriceUsd ? { priceCents: { lte: toCents(a.maxPriceUsd) } } : {}) },
      include: { inventory: true, store: { include: { merchant: true } } },
      take: 10,
    });
    return {
      count: results.length,
      products: results.map((p) => ({
        productId: p.id,
        title: p.title,
        category: p.category,
        price: money(p.priceCents),
        inStock: Math.max(0, (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0)),
        acceptedAssets: p.acceptedAssets,
        negotiable: p.negotiable,
        store: { storeId: p.storeId, name: p.store.name, verified: p.store.merchant.verified },
        demoListing: p.isFixture,
      })),
    };
  },

  async get_product(a) {
    const p = await prisma.product.findFirst({ where: { id: a.productId, status: "ACTIVE" }, include: { inventory: true, store: { include: { merchant: true } }, reviews: { take: 5, orderBy: { createdAt: "desc" } } } });
    if (!p) return { error: "NOT_FOUND", message: "No active product with that id. Use search_products to get a valid productId." };
    const agg = await prisma.review.aggregate({ where: { productId: p.id }, _avg: { rating: true }, _count: true });
    return {
      productId: p.id,
      title: p.title,
      price: money(p.priceCents),
      inStock: Math.max(0, (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0)),
      acceptedAssets: p.acceptedAssets,
      negotiable: p.negotiable,
      deliveryType: p.deliveryType,
      specs: p.specs,
      rating: agg._count ? { average: Number(agg._avg.rating?.toFixed(2)), verifiedReviews: agg._count } : null,
      store: { storeId: p.storeId, name: p.store.name, verified: p.store.merchant.verified },
      demoListing: p.isFixture,
      untrusted: { description: p.description.slice(0, 1500), shipping: p.shippingInfo, returnPolicy: p.store.returnPolicy.slice(0, 600), recentReviews: p.reviews.map((r) => ({ rating: r.rating, text: r.body.slice(0, 300) })) },
    };
  },

  async get_seller(a) {
    const s = await prisma.store.findUnique({ where: { id: a.storeId }, include: { merchant: true } });
    if (!s) return { error: "NOT_FOUND", message: "No store with that id." };
    const [settled, refunded, disputed, agg] = await Promise.all([
      prisma.order.count({ where: { storeId: s.id, state: "RELEASED" } }),
      prisma.order.count({ where: { storeId: s.id, state: "REFUNDED" } }),
      prisma.order.count({ where: { storeId: s.id, state: "DISPUTED" } }),
      prisma.review.aggregate({ where: { product: { storeId: s.id } }, _avg: { rating: true }, _count: true }),
    ]);
    return {
      storeId: s.id,
      name: s.name,
      verifiedMerchant: s.merchant.verified,
      demoStore: s.isFixture,
      memberSince: s.createdAt.toISOString().slice(0, 10),
      settledOrders: settled,
      refundedOrders: refunded,
      openDisputes: disputed,
      rating: agg._count ? { average: Number(agg._avg.rating?.toFixed(2)), verifiedReviews: agg._count } : null,
      note: agg._count === 0 ? "No verified reviews yet; ratings come only from settled orders." : undefined,
    };
  },

  async compare_products(a) {
    const rows = await prisma.product.findMany({ where: { id: { in: a.productIds }, status: "ACTIVE" }, include: { inventory: true, store: { include: { merchant: true } } } });
    const ratings = await prisma.review.groupBy({ by: ["productId"], where: { productId: { in: a.productIds } }, _avg: { rating: true }, _count: true });
    const rm = new Map(ratings.map((r) => [r.productId, r]));
    const items = rows
      .map((p) => ({
        productId: p.id,
        title: p.title,
        price: money(p.priceCents),
        inStock: Math.max(0, (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0)),
        seller: p.store.name,
        verifiedSeller: p.store.merchant.verified,
        rating: rm.get(p.id) ? Number(rm.get(p.id)!._avg.rating?.toFixed(2)) : null,
        negotiable: p.negotiable,
      }))
      .sort((x, y) => x.price.usd - y.price.usd);
    return { cheapest: items[0]?.productId ?? null, items };
  },

  async check_spending_policy(a, ctx) {
    if (!ctx.agent) return { allowed: false, reasons: ["No agent is attached to this conversation; purchases need the user's approval in checkout."] };
    return policyView(await checkSpendingPolicy(ctx.agent, { totalCents: toCents(a.totalUsd), storeId: a.storeId, asset: a.asset }));
  },

  async start_negotiation(a, ctx) {
    if (!(await prisma.product.findUnique({ where: { id: a.productId }, select: { id: true } }))) {
      return { error: "NOT_FOUND", message: "No product with that id. Use search_products to get a valid productId." };
    }
    const n = await openNegotiation({ buyerId: ctx.userId, productId: a.productId, quantity: a.quantity, asset: a.asset, buyerAgentId: ctx.agent?.id });
    // An open negotiation may already exist; return its full history so the agent continues it correctly.
    return negotiationView(await getNegotiation(n.id, { userId: ctx.userId }));
  },

  async make_offer(a, ctx) {
    const n = await getNegotiation(a.negotiationId, { userId: ctx.userId });
    const priceCents = toCents(a.priceUsd);
    // Guard against unit mistakes (e.g. sending cents as dollars): far-below-list offers are refused, not sent.
    if (priceCents < Math.floor(n.listPriceCents * 0.5)) {
      return { error: "OFFER_TOO_LOW", message: `$${a.priceUsd} is less than half the $${n.listPriceCents / 100} list price. Prices are in US dollars; check the amount.` };
    }
    const p = ctx.agent?.policy;
    // Buyer-side negotiation limits: never offer above the per-order cap; never ask for more discount than allowed.
    if (p && priceCents * n.quantity > p.maxPerOrderCents) return { error: "OVER_LIMIT", message: `Offer would exceed the agent's per-order limit of ${formatUsd(p.maxPerOrderCents)}.` };
    if (p && priceCents < Math.floor(n.listPriceCents * (1 - p.maxDiscountAskBps / 10_000))) {
      return { error: "DISCOUNT_TOO_DEEP", message: `The user allows asking for at most ${p.maxDiscountAskBps / 100}% off list.` };
    }
    if (p && n.rounds >= p.maxNegotiationRounds * 2) return { error: "ROUND_LIMIT", message: "Reached the user's negotiation round limit." };
    const o = await submitOffer({ negotiationId: a.negotiationId, actorUserId: ctx.userId, from: "BUYER", priceCents, message: a.message, byAgent: true, agentId: ctx.agent?.id });
    // Seller agents usually answer within seconds; include their reply when it arrives.
    await ctx.onStep?.("Waiting for seller response");
    const after = await impl.check_negotiation({ negotiationId: a.negotiationId }, { ...ctx, onStep: undefined });
    return { offered: money(priceCents), termsHash: o.termsHash, negotiation: after };
  },

  async check_negotiation(a, ctx) {
    // Seller agents usually reply within seconds; wait briefly for a reply before returning.
    for (let i = 0; i < 15; i++) {
      const n = await getNegotiation(a.negotiationId, { userId: ctx.userId });
      const last = n.offers.at(-1);
      if (n.status !== "OPEN" || (last && last.from === "SELLER") || !n.sellerAgentActive) return negotiationView(n);
      await new Promise((r) => setTimeout(r, 1000));
    }
    const n = await getNegotiation(a.negotiationId, { userId: ctx.userId });
    return { ...negotiationView(n), note: "No reply yet. The seller may respond later; the user will be notified." };
  },

  async accept_counter(a, ctx) {
    const n = await getNegotiation(a.negotiationId, { userId: ctx.userId });
    const last = n.offers.at(-1);
    if (ctx.agent?.policy && last && last.priceCents * n.quantity > ctx.agent.policy.maxPerOrderCents) {
      return { error: "OVER_LIMIT", message: "The counteroffer exceeds the agent's per-order limit. Ask the user." };
    }
    return acceptOffer({ negotiationId: a.negotiationId, actorUserId: ctx.userId, as: "BUYER", byAgent: true });
  },

  async withdraw_negotiation(a, ctx) {
    await rejectNegotiation({ negotiationId: a.negotiationId, actorUserId: ctx.userId, as: "BUYER", byAgent: true });
    return { ok: true };
  },

  async prepare_checkout(a, ctx) {
    const product = await prisma.product.findUnique({ where: { id: a.productId } });
    if (!product) return { error: "NOT_FOUND", message: "Product not found." };
    let unit = product.priceCents;
    if (a.negotiationId) {
      const n = await getNegotiation(a.negotiationId, { userId: ctx.userId });
      if (n.status !== "ACCEPTED" || n.agreedCents == null) return { error: "NOT_ACCEPTED", message: "That negotiation has no accepted price." };
      unit = n.agreedCents;
    }
    const total = unit * a.quantity;
    const agent = ctx.agent;
    // Autonomous only for assets on the chain where the agent's smart account lives.
    const sameChain = agent?.accountChainId != null && chainIdForAsset(a.asset) === agent.accountChainId;
    const autonomous = Boolean(agent?.policy?.automationEnabled && agent.accountAddress && sameChain && process.env.AUTONOMOUS_PAYMENTS_ENABLED === "true");
    const policyRaw = agent ? await checkSpendingPolicy(agent, { totalCents: total, storeId: product.storeId, asset: a.asset, category: product.category }) : null;
    const policy = policyRaw ? policyView(policyRaw) : null;

    if (!autonomous || !policyRaw?.allowed) {
      // Hand the purchase to the user: they review and pay from their own wallet.
      const link = `/checkout?product=${product.id}&qty=${a.quantity}&asset=${a.asset}${a.negotiationId ? `&negotiation=${a.negotiationId}` : ""}`;
      return {
        mode: "USER_APPROVAL_REQUIRED",
        total: money(total),
        checkoutLink: link,
        policy,
        reason: !agent
          ? "No agent policy."
          : agent.accountAddress && !sameChain
            ? `The agent's smart account is on another network; ${a.asset} needs the user's approval.`
            : !autonomous
              ? "Autonomous payments are not enabled for this agent."
              : policyRaw?.reasons.join(" "),
      };
    }
    const wallet = await prisma.wallet.findFirst({ where: { userId: ctx.userId } });
    if (!wallet) return { error: "NO_WALLET", message: "User has no wallet." };
    const q = await createCheckoutQuote({ buyerId: ctx.userId, payerAddress: agent!.accountAddress!, productId: product.id, quantity: a.quantity, asset: a.asset, negotiationId: a.negotiationId, agentId: agent!.id });
    return { mode: "AGENT_PAYABLE", orderId: q.orderId, total: money(q.totalCents), asset: q.asset, quoteExpires: new Date(Number(q.quote.deadline) * 1000).toISOString(), policy };
  },

  async execute_purchase(a, ctx) {
    const agent = ctx.agent;
    if (!agent) return { error: "NO_AGENT", message: "No agent." };
    const order = await prisma.order.findUnique({ where: { id: a.orderId } });
    if (!order || order.buyerId !== ctx.userId || order.agentId !== agent.id) return { error: "NOT_FOUND", message: "No agent order with that id." };
    if (order.state !== "AWAITING_PAYMENT") return { state: order.state, note: "Already processed." };
    const policy = await checkSpendingPolicy(agent, { totalCents: 0, storeId: order.storeId, asset: order.asset });
    if (!policy.allowed) return { error: "POLICY_DENIED", reasons: policy.reasons };
    // The payment is executed by the worker (idempotent per order). The contract re-checks every limit.
    await enqueueJob(prisma, "agent.execute_payment", { orderId: order.id, agentId: agent.id }, { idempotencyKey: `agent.pay:${order.id}`, maxAttempts: 3 });
    for (let i = 0; i < 40; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const o = await prisma.order.findUnique({ where: { id: order.id } });
      if (o && o.state !== "AWAITING_PAYMENT") return { orderId: o.id, state: o.state, note: "Confirmed by escrow event." };
      const job = await prisma.job.findUnique({ where: { idempotencyKey: `agent.pay:${order.id}` } });
      if (job?.status === "FAILED") return { error: "PAYMENT_FAILED", message: job.lastError };
    }
    return { orderId: order.id, state: "AWAITING_PAYMENT", note: "Payment submitted; confirmation pending." };
  },

  async track_orders(a, ctx) {
    const rows = await prisma.order.findMany({ where: { buyerId: ctx.userId, state: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: a.limit, include: { product: true, store: true } });
    return { orders: rows.map((o) => ({ orderId: o.id, product: o.product.title, store: o.store.name, total: money(o.totalCents), asset: o.asset, state: o.state, byAgent: Boolean(o.agentId), createdAt: o.createdAt })) };
  },
};
