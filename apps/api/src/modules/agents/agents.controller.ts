import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { getAddress, type Hex } from "viem";
import { z } from "zod";
import { agentAccountAbi, agentPolicyModuleAbi } from "@commerce-os/blockchain";
import { acceptOffer, checkSpendingPolicy, deployment, getNegotiation, openNegotiation, publicClient, rejectNegotiation, submitOffer } from "@commerce-os/commerce";
import { audit, enqueueJob, notify } from "@commerce-os/database";
import { agentPolicySchema, createAgentSchema, offerSchema } from "@commerce-os/shared";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { AppError, badRequest, forbidden, notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { ownedStore } from "../merchant/merchant.controller";

async function ownedAgent(a: AuthContext, id: string) {
  const agent = await prisma.agent.findUnique({ where: { id }, include: { policy: true } });
  if (!agent) throw notFound("Agent");
  if (agent.ownerId !== a.userId) throw forbidden("You do not manage this agent.");
  return agent;
}

const aiReady = () => Boolean(process.env.OPENAI_API_KEY);

@Controller()
@Auth()
export class AgentsController {
  @Get("agents/config")
  config() {
    let d: ReturnType<typeof deployment> | null = null;
    try {
      d = deployment();
    } catch {
      d = null;
    }
    return {
      aiConfigured: aiReady(),
      aiModel: aiReady() ? process.env.OPENAI_MODEL || "gpt-4.1-mini" : null,
      autonomousPaymentsEnabled: process.env.AUTONOMOUS_PAYMENTS_ENABLED === "true" && Boolean(process.env.AGENT_EXECUTOR) && Boolean(d),
      executor: process.env.AGENT_EXECUTOR ?? null,
      accountFactory: d?.accountFactory ?? null,
      policyModule: d?.policyModule ?? null,
      usdg: d?.usdg ?? null,
    };
  }

  @Get("agents")
  async list(@CurrentUser() a: AuthContext) {
    const items = await prisma.agent.findMany({
      where: { ownerId: a.userId },
      orderBy: { createdAt: "desc" },
      include: { policy: true, store: { select: { id: true, name: true, slug: true } }, _count: { select: { orders: true, negotiations: true, tasks: true } } },
    });
    return { items };
  }

  @Post("agents")
  async create(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const input = parse(createAgentSchema, body);
    if (input.type === "SELLER") {
      if (!input.storeId) throw badRequest("STORE_REQUIRED", "Seller agents act for a store.");
      await ownedStore(a, input.storeId);
    }
    if (input.type === "BUYER" && !input.policy) throw badRequest("POLICY_REQUIRED", "Buyer agents need a spending policy.");
    const agent = await prisma.agent.create({
      data: {
        ownerId: a.userId,
        name: input.name,
        type: input.type,
        description: input.description,
        preferences: input.preferences,
        storeId: input.type === "SELLER" ? input.storeId : null,
        policy: input.policy ? { create: { ...input.policy, automationEnabled: false } } : undefined,
      },
      include: { policy: true },
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "agent.create", target: agent.id, data: { type: input.type } });
    return agent;
  }

  @Get("agents/:id")
  async one(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const agent = await ownedAgent(a, id);
    const [tasks, activity, negotiations, orders] = await Promise.all([
      prisma.agentTask.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { toolExecutions: { orderBy: { createdAt: "asc" }, select: { tool: true, error: true, durationMs: true, createdAt: true } } } }),
      prisma.auditLog.findMany({ where: { OR: [{ actorId: id }, { target: id }] }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.negotiation.findMany({ where: agent.type === "SELLER" ? { sellerAgentId: id } : { buyerAgentId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { product: { select: { title: true } }, offers: { orderBy: { createdAt: "asc" } } } }),
      prisma.order.findMany({ where: { agentId: id }, orderBy: { createdAt: "desc" }, take: 20, include: { product: { select: { title: true } }, payments: true } }),
    ]);
    const policyCheck = agent.type === "BUYER" && agent.policy ? await checkSpendingPolicy(agent, { totalCents: 0, storeId: "", asset: agent.policy.allowedAssets[0] }) : null;
    let onchain: unknown = null;
    if (agent.accountAddress) {
      try {
        const d = deployment();
        const p = await publicClient().readContract({ address: d.policyModule, abi: agentPolicyModuleAbi, functionName: "policies", args: [agent.accountAddress as Hex] });
        const spent = await publicClient().readContract({ address: d.policyModule, abi: agentPolicyModuleAbi, functionName: "spentInWindow", args: [agent.accountAddress as Hex] });
        onchain = { maxPerOrderUsd: p[0].toString(), rollingLimitUsd: p[1].toString(), window: Number(p[2]), expiresAt: Number(p[3]), allowedAssets: p[4], merchantAllowlist: p[5], revoked: p[6], nonce: p[7].toString(), spentInWindowUsd: spent.toString() };
      } catch {
        onchain = { error: "unreachable" };
      }
    }
    return { ...agent, tasks, activity, negotiations, orders, policyCheck, onchain };
  }

  @Patch("agents/:id")
  async update(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const agent = await ownedAgent(a, id);
    const input = parse(z.object({ name: z.string().trim().min(2).max(60).optional(), description: z.string().max(500).optional(), preferences: z.string().max(2000).optional(), policy: agentPolicySchema.optional() }), body);
    if (input.policy && agent.type !== "BUYER") throw badRequest("NO_POLICY", "Only buyer agents have spending policies.");
    if (input.policy && input.policy.automationEnabled && !agent.accountAddress) throw badRequest("NO_ACCOUNT", "Deploy and link an agent smart account before enabling automation.");
    const updated = await prisma.agent.update({
      where: { id },
      data: {
        name: input.name,
        description: input.description,
        preferences: input.preferences,
        policy: input.policy ? { upsert: { create: input.policy, update: { ...input.policy, revokedAt: null, version: { increment: 1 } } } } : undefined,
      },
      include: { policy: true },
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "agent.update", target: id, data: Object.keys(input) });
    return updated;
  }

  @Post("agents/:id/pause")
  @HttpCode(200)
  pause(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    return this.control(a, id, "pause");
  }
  @Post("agents/:id/resume")
  @HttpCode(200)
  resume(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    return this.control(a, id, "resume");
  }
  @Post("agents/:id/revoke")
  @HttpCode(200)
  revoke(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    return this.control(a, id, "revoke");
  }

  private async control(a: AuthContext, id: string, action: "pause" | "resume" | "revoke") {
    const agent = await ownedAgent(a, id);
    if (action === "resume" && agent.status === "REVOKED") throw badRequest("REVOKED", "A revoked agent cannot resume. Edit its policy to issue a new authorization.");
    const status = action === "pause" ? "PAUSED" : action === "resume" ? "ACTIVE" : "REVOKED";
    await prisma.agent.update({ where: { id }, data: { status, ...(action === "revoke" && agent.policy ? { policy: { update: { revokedAt: new Date(), automationEnabled: false, version: { increment: 1 } } } } : {}) } });
    if (action !== "resume") {
      await prisma.agentTask.updateMany({ where: { agentId: id, status: { in: ["QUEUED", "WAITING"] } }, data: { status: "CANCELLED" } });
    }
    await audit(prisma, { actorId: a.userId, actorType: "user", action: `agent.${action}`, target: id });
    return { ok: true, status, note: action === "revoke" && agent.accountAddress ? "Also revoke on-chain from Agent Studio so the policy contract blocks the agent key." : undefined };
  }

  /** Link an AgentAccount after the owner deployed it. Verified on-chain: owner and agent key must match. */
  @Post("agents/:id/account")
  @HttpCode(200)
  async linkAccount(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const agent = await ownedAgent(a, id);
    const { accountAddress } = parse(z.object({ accountAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/) }), body);
    const addr = getAddress(accountAddress);
    const client = publicClient();
    const [owner, key, escrow] = await Promise.all([
      client.readContract({ address: addr, abi: agentAccountAbi, functionName: "owner" }),
      client.readContract({ address: addr, abi: agentAccountAbi, functionName: "agentKey" }),
      client.readContract({ address: addr, abi: agentAccountAbi, functionName: "escrow" }),
    ]).catch(() => {
      throw badRequest("NOT_AN_ACCOUNT", "That address is not a Commerce OS agent account on this network.");
    });
    if (owner.toLowerCase() !== a.address) throw badRequest("WRONG_OWNER", "That account is owned by a different wallet.");
    if (escrow.toLowerCase() !== deployment().escrow.toLowerCase()) throw badRequest("WRONG_ESCROW", "That account is bound to a different escrow.");
    if (!process.env.AGENT_EXECUTOR || key.toLowerCase() !== process.env.AGENT_EXECUTOR.toLowerCase()) throw badRequest("WRONG_AGENT_KEY", "Set the account's agent key to the Commerce OS executor first.");
    await prisma.agent.update({ where: { id: agent.id }, data: { accountAddress: addr.toLowerCase() } });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "agent.link_account", target: id, data: { addr } });
    return { ok: true };
  }

  // ----------------------------------------------------------- conversations

  @Get("conversations")
  async conversations(@CurrentUser() a: AuthContext) {
    const items = await prisma.conversation.findMany({ where: { userId: a.userId }, orderBy: { updatedAt: "desc" }, take: 50, include: { agent: { select: { id: true, name: true } } } });
    return { items };
  }

  @Post("conversations")
  async newConversation(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const { agentId, title } = parse(z.object({ agentId: z.string().optional().nullable(), title: z.string().max(120).optional() }), body);
    if (agentId) {
      const ag = await ownedAgent(a, agentId);
      if (ag.type !== "BUYER") throw badRequest("BUYER_ONLY", "Use a buyer agent for shopping tasks.");
    }
    return prisma.conversation.create({ data: { userId: a.userId, agentId: agentId ?? null, title: title ?? "New shopping task" } });
  }

  @Get("conversations/:id")
  async conversation(@CurrentUser() a: AuthContext, @Param("id") id: string, @Query("after") after?: string) {
    const c = await prisma.conversation.findUnique({ where: { id }, include: { agent: { include: { policy: true } } } });
    if (!c || c.userId !== a.userId) throw notFound("Conversation");
    const messages = await prisma.message.findMany({ where: { conversationId: id, ...(after ? { createdAt: { gt: new Date(after) } } : {}) }, orderBy: { createdAt: "asc" }, take: 300 });
    const task = await prisma.agentTask.findFirst({ where: { conversationId: id }, orderBy: { createdAt: "desc" } });
    return { conversation: c, messages, task };
  }

  @Post("conversations/:id/messages")
  async send(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { content } = parse(z.object({ content: z.string().trim().min(1).max(2000) }), body);
    const c = await prisma.conversation.findUnique({ where: { id }, include: { agent: true } });
    if (!c || c.userId !== a.userId) throw notFound("Conversation");
    if (!aiReady()) throw new AppError(503, "AI_NOT_CONFIGURED", "AI is not configured on this server (OPENAI_API_KEY missing). Agents can't run until an administrator sets it.");
    if (c.agent && c.agent.status !== "ACTIVE") throw badRequest("AGENT_INACTIVE", `This agent is ${c.agent.status.toLowerCase()}.`);
    const running = await prisma.agentTask.findFirst({ where: { conversationId: id, status: { in: ["QUEUED", "RUNNING"] } } });
    if (running) throw new AppError(409, "AGENT_BUSY", "The agent is still working on your last message.");
    const msg = await prisma.message.create({ data: { conversationId: id, role: "user", content } });
    const isFirst = (await prisma.message.count({ where: { conversationId: id, role: "user" } })) === 1;
    await prisma.conversation.update({ where: { id }, data: { updatedAt: new Date(), ...(isFirst ? { title: content.slice(0, 80) } : {}) } });
    const agentRow = c.agentId ? await prisma.agent.findUnique({ where: { id: c.agentId }, include: { policy: true } }) : null;
    const task = await prisma.agentTask.create({ data: { conversationId: id, agentId: c.agentId, kind: "shop", input: { messageId: msg.id, content }, policyVersion: agentRow?.policy?.version } });
    await enqueueJob(prisma, "agent.run", { taskId: task.id }, { idempotencyKey: `agent.run:${task.id}`, maxAttempts: 2 });
    return { message: msg, task };
  }

  @Post("tasks/:id/cancel")
  @HttpCode(200)
  async cancelTask(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const t = await prisma.agentTask.findUnique({ where: { id }, include: { conversation: true } });
    if (!t || t.conversation?.userId !== a.userId) throw notFound("Task");
    await prisma.agentTask.updateMany({ where: { id, status: { in: ["QUEUED", "RUNNING", "WAITING"] } }, data: { status: "CANCELLED", finishedAt: new Date() } });
    await prisma.job.updateMany({ where: { idempotencyKey: `agent.run:${id}`, status: "QUEUED" }, data: { status: "CANCELLED" } });
    return { ok: true };
  }

  // ------------------------------------------------------------ negotiations

  @Post("negotiations")
  async open(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const i = parse(z.object({ productId: z.string(), quantity: z.number().int().min(1).max(10).default(1), asset: z.enum(["USDG", "ETH"]).default("USDG") }), body);
    return openNegotiation({ buyerId: a.userId, ...i });
  }

  @Get("negotiations")
  async mine(@CurrentUser() a: AuthContext) {
    const items = await prisma.negotiation.findMany({ where: { buyerId: a.userId }, orderBy: { updatedAt: "desc" }, take: 50, include: { product: { select: { title: true, images: true, priceCents: true } }, store: { select: { name: true } }, offers: { orderBy: { createdAt: "asc" } } } });
    return { items };
  }

  @Get("negotiations/:id")
  get(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    return getNegotiation(id, { userId: a.userId, role: a.role });
  }

  @Post("negotiations/:id/offers")
  async offer(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const i = parse(offerSchema.pick({ priceCents: true, message: true }), body);
    const n = await getNegotiation(id, { userId: a.userId });
    return submitOffer({ negotiationId: id, actorUserId: a.userId, from: n.role === "seller" ? "SELLER" : "BUYER", priceCents: i.priceCents, message: i.message });
  }

  @Post("negotiations/:id/accept")
  @HttpCode(200)
  async accept(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const n = await getNegotiation(id, { userId: a.userId });
    return acceptOffer({ negotiationId: id, actorUserId: a.userId, as: n.role === "seller" ? "SELLER" : "BUYER" });
  }

  @Post("negotiations/:id/reject")
  @HttpCode(200)
  async reject(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const n = await getNegotiation(id, { userId: a.userId });
    await rejectNegotiation({ negotiationId: id, actorUserId: a.userId, as: n.role === "seller" ? "SELLER" : "BUYER" });
    return { ok: true };
  }

  @Get("merchant/negotiations")
  async storeNegotiations(@CurrentUser() a: AuthContext, @Query("storeId") storeId: string) {
    await ownedStore(a, storeId);
    const items = await prisma.negotiation.findMany({ where: { storeId }, orderBy: { updatedAt: "desc" }, take: 100, include: { product: { select: { title: true, priceCents: true, floorPriceCents: true } }, offers: { orderBy: { createdAt: "asc" } }, buyerAgent: { select: { name: true } } } });
    return { items };
  }

  /** Enable/disable the store's seller agent. */
  @Post("merchant/stores/:id/agent")
  @HttpCode(200)
  async sellerAgent(@CurrentUser() a: AuthContext, @Param("id") storeId: string, @Body() body: unknown) {
    const store = await ownedStore(a, storeId);
    const { enabled, name, preferences } = parse(z.object({ enabled: z.boolean(), name: z.string().max(60).optional(), preferences: z.string().max(2000).optional() }), body);
    const existing = await prisma.agent.findFirst({ where: { storeId, type: "SELLER", status: { not: "REVOKED" } } });
    if (existing) {
      const u = await prisma.agent.update({ where: { id: existing.id }, data: { status: enabled ? "ACTIVE" : "PAUSED", name: name ?? undefined, preferences: preferences ?? undefined } });
      await audit(prisma, { actorId: a.userId, actorType: "user", action: enabled ? "seller_agent.enable" : "seller_agent.pause", target: u.id });
      return u;
    }
    if (!enabled) return null;
    const created = await prisma.agent.create({ data: { ownerId: a.userId, storeId, type: "SELLER", name: name ?? `${store.name} sales agent`, description: "Answers buyer offers within your floor prices.", preferences: preferences ?? "" } });
    await prisma.negotiation.updateMany({ where: { storeId, status: "OPEN", sellerAgentId: null }, data: { sellerAgentId: created.id } });
    await notify(prisma, a.userId, { kind: "agent.created", title: "Sales agent enabled", body: "It will answer offers on negotiable listings within your floor prices.", href: "/sell?tab=agent" });
    return created;
  }
}
