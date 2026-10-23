import { Body, Controller, Get, HttpCode, Param, Post, Query } from "@nestjs/common";
import { formatUnits, type Hex } from "viem";
import { z } from "zod";
import { commerceEscrowAbi, explorerAddress, explorerTx } from "@commerce-os/blockchain";
import { deployment, enabledChains, publicClient } from "@commerce-os/commerce";
import { FLAGS, audit, enqueueJob, notify } from "@commerce-os/database";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { badRequest, notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { config } from "../../config";

/**
 * Admin console API. Every write is audited. No endpoint can move escrowed funds: escrow
 * administration (pause, signer rotation, fees) is on-chain and owned by the multisig.
 */
@Controller("admin")
@Auth("admin")
export class AdminController {
  @Get("overview")
  async overview() {
    const [users, merchants, unverified, products, orders, disputes, agents, failedJobs, flags] = await Promise.all([
      prisma.user.count(),
      prisma.merchant.count(),
      prisma.merchant.count({ where: { verified: false } }),
      prisma.product.count({ where: { status: "ACTIVE" } }),
      prisma.order.groupBy({ by: ["state"], _count: true, _sum: { totalCents: true } }),
      prisma.dispute.count({ where: { status: { in: ["OPEN", "EVIDENCE"] } } }),
      prisma.agent.groupBy({ by: ["status"], _count: true }),
      prisma.job.count({ where: { status: "FAILED" } }),
      prisma.systemFlag.findMany(),
    ]);
    const chains = await Promise.all(enabledChains().map(async (chainId) => {
      try {
        const d = deployment(chainId);
        const c = publicClient(chainId);
        const erc20 = [{ type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ type: "address" }], outputs: [{ type: "uint256" }] }] as const;
        const [paused, liabStable, liabNative, owner, signer, treasuryNative, treasuryStable] = await Promise.all([
          c.readContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "paused" }),
          c.readContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "liabilities", args: [d.stable] }),
          c.readContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "liabilities", args: ["0x0000000000000000000000000000000000000000"] }),
          c.readContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "owner" }),
          c.readContract({ address: d.escrow, abi: commerceEscrowAbi, functionName: "quoteSigner" }),
          c.getBalance({ address: d.treasury }),
          c.readContract({ address: d.stable, abi: erc20, functionName: "balanceOf", args: [d.treasury] }),
        ]);
        return {
          chainId,
          escrow: d.escrow,
          escrowExplorer: explorerAddress(chainId, d.escrow),
          paused,
          owner,
          quoteSigner: signer,
          stableSymbol: d.stableSymbol,
          nativeSymbol: d.nativeSymbol,
          escrowedStable: formatUnits(liabStable, d.stableDecimals),
          escrowedNative: formatUnits(liabNative, 18),
          treasury: d.treasury,
          treasuryStable: formatUnits(treasuryStable, d.stableDecimals),
          treasuryNative: formatUnits(treasuryNative, 18),
          testToken: d.testToken,
        };
      } catch (e) {
        return { chainId, error: (e as Error).message };
      }
    }));
    const released = orders.find((o) => o.state === "RELEASED");
    return {
      users,
      merchants,
      unverifiedMerchants: unverified,
      activeProducts: products,
      ordersByState: Object.fromEntries(orders.map((o) => [o.state, { count: o._count, cents: o._sum.totalCents ?? 0 }])),
      feesEarnedCents: Math.floor(((released?._sum.totalCents ?? 0) * 200) / 10_000),
      openDisputes: disputes,
      agentsByStatus: Object.fromEntries(agents.map((a) => [a.status, a._count])),
      failedJobs,
      flags: Object.fromEntries(flags.map((f) => [f.key, { value: f.value, reason: f.reason, updatedAt: f.updatedAt }])),
      chains,
    };
  }

  @Get("users")
  async users(@Query("q") q?: string) {
    const items = await prisma.user.findMany({
      where: q ? { OR: [{ wallets: { some: { address: { contains: q.toLowerCase() } } } }, { displayName: { contains: q, mode: "insensitive" } }] } : {},
      orderBy: { createdAt: "desc" },
      take: 100,
      include: { wallets: true, merchant: true, _count: { select: { ordersBought: true, agents: true } } },
    });
    return { items };
  }

  @Post("users/:id/suspend")
  @HttpCode(200)
  async suspend(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { suspended, reason } = parse(z.object({ suspended: z.boolean(), reason: z.string().min(3).max(500) }), body);
    if (id === a.userId) throw badRequest("SELF", "You cannot suspend yourself.");
    await prisma.user.update({ where: { id }, data: { suspended } });
    if (suspended) {
      await prisma.session.updateMany({ where: { userId: id, revokedAt: null }, data: { revokedAt: new Date() } });
      await prisma.agent.updateMany({ where: { ownerId: id, status: "ACTIVE" }, data: { status: "PAUSED" } });
    }
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: suspended ? "admin.user.suspend" : "admin.user.unsuspend", target: id, data: { reason } });
    return { ok: true };
  }

  @Get("merchants")
  async merchants() {
    const items = await prisma.merchant.findMany({ orderBy: { createdAt: "desc" }, take: 200, include: { user: { include: { wallets: true } }, stores: { include: { _count: { select: { products: true, orders: true } } } } } });
    return { items };
  }

  @Post("merchants/:id/verify")
  @HttpCode(200)
  async verify(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { verified, note } = parse(z.object({ verified: z.boolean(), note: z.string().max(500).default("") }), body);
    const m = await prisma.merchant.update({ where: { id }, data: { verified, verifiedAt: verified ? new Date() : null }, include: { stores: true } });
    for (const s of m.stores) await enqueueJob(prisma, "registry.sync", { storeId: s.id }, { maxAttempts: 8 });
    await notify(prisma, m.userId, { kind: "merchant.verification", title: verified ? "Your store is verified" : "Verification removed", body: note || (verified ? "Buyers now see a verified badge on your listings." : "Contact support for details."), href: "/sell" });
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: verified ? "admin.merchant.verify" : "admin.merchant.unverify", target: id, data: { note } });
    return { ok: true };
  }

  @Post("stores/:id/active")
  @HttpCode(200)
  async storeActive(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { active, reason } = parse(z.object({ active: z.boolean(), reason: z.string().min(3).max(500) }), body);
    await prisma.store.update({ where: { id }, data: { active } });
    await enqueueJob(prisma, "registry.sync", { storeId: id }, { maxAttempts: 8 });
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: active ? "admin.store.activate" : "admin.store.deactivate", target: id, data: { reason } });
    return { ok: true };
  }

  @Get("products")
  async products(@Query("status") status?: string, @Query("q") q?: string) {
    const items = await prisma.product.findMany({
      where: { ...(status ? { status: status as any } : {}), ...(q ? { title: { contains: q, mode: "insensitive" } } : {}) },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: { store: { select: { name: true, slug: true } } },
    });
    return { items: items.map(({ floorPriceCents: _f, ...p }) => p) };
  }

  @Post("products/:id/moderate")
  @HttpCode(200)
  async moderate(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { action, reason } = parse(z.object({ action: z.enum(["remove", "restore"]), reason: z.string().min(3).max(500) }), body);
    const p = await prisma.product.findUnique({ where: { id }, include: { store: { include: { merchant: true } } } });
    if (!p) throw notFound("Product");
    await prisma.product.update({ where: { id }, data: { status: action === "remove" ? "REMOVED" : "ACTIVE" } });
    await notify(prisma, p.store.merchant.userId, { kind: "moderation", title: action === "remove" ? "A listing was removed" : "A listing was restored", body: `${p.title}: ${reason}`, href: "/sell?tab=products" });
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: `admin.product.${action}`, target: id, data: { reason } });
    return { ok: true };
  }

  @Get("orders")
  async orders(@Query("state") state?: string) {
    const items = await prisma.order.findMany({ where: state ? { state: state as any } : {}, orderBy: { createdAt: "desc" }, take: 200, include: { product: { select: { title: true } }, store: { select: { name: true } }, payments: true } });
    return { items: items.map((o) => ({ ...o, shipping: undefined, explorer: o.payments[0] ? explorerTx(o.chainId, o.payments[0].txHash) : null })) };
  }

  @Get("disputes")
  async disputes() {
    const items = await prisma.dispute.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { evidence: { orderBy: { createdAt: "asc" } }, order: { include: { product: { select: { title: true } }, store: { select: { name: true } } } } } });
    return { items: items.map((d) => ({ ...d, order: { ...d.order, shipping: undefined } })) };
  }

  @Get("agents")
  async agents() {
    const [tasks, failedTools, payments] = await Promise.all([
      prisma.agentTask.findMany({ orderBy: { createdAt: "desc" }, take: 100, include: { agent: { select: { name: true, type: true } }, _count: { select: { toolExecutions: true } } } }),
      prisma.agentToolExecution.findMany({ where: { error: { not: null } }, orderBy: { createdAt: "desc" }, take: 50 }),
      prisma.auditLog.findMany({ where: { action: { startsWith: "agent.payment" } }, orderBy: { createdAt: "desc" }, take: 50 }),
    ]);
    return { tasks, failedTools, payments };
  }

  @Get("audit")
  async auditLog(@Query("action") action?: string) {
    const items = await prisma.auditLog.findMany({ where: action ? { action: { startsWith: action } } : {}, orderBy: { createdAt: "desc" }, take: 300 });
    return { items };
  }

  @Get("security")
  async security() {
    const items = await prisma.auditLog.findMany({ where: { OR: [{ action: { startsWith: "security." } }, { action: { startsWith: "admin." } }, { action: "agent.payment_rejected_onchain" }, { action: "agent.payment_refused" }] }, orderBy: { createdAt: "desc" }, take: 200 });
    const failedJobs = await prisma.job.findMany({ where: { status: "FAILED" }, orderBy: { updatedAt: "desc" }, take: 50 });
    return { events: items, failedJobs };
  }

  /** Off-chain kill switches. On-chain escrow pause is done by the pauser/multisig wallet directly. */
  @Post("flags")
  @HttpCode(200)
  async setFlag(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const { key, value, reason } = parse(z.object({ key: z.enum([FLAGS.checkoutPaused, FLAGS.agentsPaused]), value: z.boolean(), reason: z.string().min(3).max(500) }), body);
    await prisma.systemFlag.upsert({ where: { key }, create: { key, value, reason, updatedBy: a.userId }, update: { value, reason, updatedBy: a.userId } });
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: `admin.flag.${key}`, data: { value, reason } });
    return { ok: true };
  }

  @Post("jobs/:id/retry")
  @HttpCode(200)
  async retryJob(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const j = await prisma.job.findUnique({ where: { id } });
    if (!j || j.status !== "FAILED") throw badRequest("NOT_FAILED", "Only failed jobs can be retried.");
    if (j.kind === "agent.execute_payment") throw badRequest("NO_RETRY", "Agent payments are never retried manually; ask the user to start a new purchase.");
    await prisma.job.update({ where: { id }, data: { status: "QUEUED", attempts: 0, runAt: new Date(), lastError: null } });
    await audit(prisma, { actorId: a.userId, actorType: "admin", action: "admin.job.retry", target: id });
    return { ok: true };
  }

  @Get("orders/:id/chain")
  async orderChain(@Param("id") id: string) {
    const o = await prisma.order.findUnique({ where: { id }, include: { events: { orderBy: [{ blockNumber: "asc" }, { logIndex: "asc" }] } } });
    if (!o) throw notFound("Order");
    const onchain = await publicClient(o.chainId).readContract({ address: deployment(o.chainId).escrow, abi: commerceEscrowAbi, functionName: "getOrder", args: [o.onchainId as Hex] });
    return { events: o.events.map((e) => ({ ...e, blockNumber: e.blockNumber.toString() })), onchain: JSON.parse(JSON.stringify(onchain, (_, v) => (typeof v === "bigint" ? v.toString() : v))) };
  }
}
