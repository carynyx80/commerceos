import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from "@nestjs/common";
import { keccak256, toHex } from "viem";
import { z } from "zod";
import { audit, enqueueJob, notify } from "@commerce-os/database";
import { checkoutSchema } from "@commerce-os/shared";
import { createCheckoutQuote } from "@commerce-os/commerce";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { config } from "../../config";
import { orderInclude, orderView } from "./serialize";

const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/);

async function loadOrder(id: string) {
  const o = await prisma.order.findUnique({ where: { id }, include: { ...orderInclude, store: { include: { merchant: true } } } });
  if (!o) throw notFound("Order");
  return o;
}

@Controller()
@Auth()
export class OrdersController {
  /** Server-priced, signed quote. Creates the order (AWAITING_PAYMENT) and reserves stock. */
  @Post("checkout/quote")
  async quote(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const input = parse(checkoutSchema, body);
    return createCheckoutQuote({ buyerId: a.userId, payerAddress: a.address, productId: input.productId, quantity: input.quantity, asset: input.asset, negotiationId: input.negotiationId, shipping: input.shipping });
  }

  /**
   * Record a submitted payment transaction. This does NOT mark the order paid: the indexer
   * moves it to FUNDED only after the OrderFunded event is confirmed on-chain.
   */
  @Post("orders/:id/payment")
  @HttpCode(200)
  async payment(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { txHash: hash } = parse(z.object({ txHash }), body);
    const o = await loadOrder(id);
    if (o.buyerId !== a.userId) throw forbidden();
    await prisma.payment.upsert({
      where: { txHash: hash.toLowerCase() },
      create: { orderId: o.id, txHash: hash.toLowerCase(), chainId: config.chainId, from: a.address, asset: o.asset, amount: o.amount, status: "SUBMITTED" },
      update: {},
    });
    await enqueueJob(prisma, "payment.verify", { orderId: o.id, txHash: hash.toLowerCase() }, { idempotencyKey: `payment.verify:${hash.toLowerCase()}`, maxAttempts: 30 });
    return { ok: true, state: o.state };
  }

  @Get("orders")
  async mine(@CurrentUser() a: AuthContext) {
    const rows = await prisma.order.findMany({ where: { buyerId: a.userId, NOT: { state: "CANCELLED", payments: { none: {} } } }, orderBy: { createdAt: "desc" }, include: orderInclude, take: 100 });
    return { items: rows.map(orderView) };
  }

  @Get("orders/:id")
  async one(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const o = await loadOrder(id);
    const isSeller = o.store.merchant.userId === a.userId;
    if (o.buyerId !== a.userId && !isSeller && a.role !== "ADMIN") throw forbidden();
    return { ...orderView(o), role: o.buyerId === a.userId ? "buyer" : isSeller ? "seller" : "admin", shipping: isSeller || o.buyerId === a.userId ? o.shipping : null };
  }

  @Get("merchant/orders")
  async sellerOrders(@CurrentUser() a: AuthContext, @Query("storeId") storeId?: string) {
    const rows = await prisma.order.findMany({
      where: { store: { merchant: { userId: a.userId }, ...(storeId ? { id: storeId } : {}) }, state: { notIn: ["CREATED", "AWAITING_PAYMENT", "CANCELLED"] } },
      orderBy: { createdAt: "desc" },
      include: orderInclude,
      take: 200,
    });
    return { items: rows.map((o) => ({ ...orderView(o), shipping: o.shipping })) };
  }

  @Patch("merchant/orders/:id/tracking")
  async tracking(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { trackingInfo } = parse(z.object({ trackingInfo: z.string().trim().min(1).max(300) }), body);
    const o = await loadOrder(id);
    if (o.store.merchant.userId !== a.userId) throw forbidden();
    if (!["ACCEPTED", "IN_FULFILLMENT", "FULFILLED"].includes(o.state)) throw badRequest("WRONG_STATE", "Tracking can be added after you accept the order.");
    await prisma.order.update({ where: { id }, data: { trackingInfo } });
    if (o.state === "ACCEPTED") {
      await prisma.$transaction([
        prisma.order.update({ where: { id }, data: { state: "IN_FULFILLMENT" } }),
        prisma.orderTransition.create({ data: { orderId: id, from: "ACCEPTED", to: "IN_FULFILLMENT", source: "api" } }),
      ]);
    }
    await notify(prisma, o.buyerId, { kind: "order.fulfillment", title: "Your order is on its way", body: `${o.product.title}: ${trackingInfo}`, href: `/orders/${id}` });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "order.tracking", target: id });
    return { ok: true };
  }

  /** Off-chain dispute record and evidence. The on-chain openDispute is sent by the party's wallet. */
  @Post("orders/:id/dispute")
  async dispute(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { reason } = parse(z.object({ reason: z.string().trim().min(10).max(2000) }), body);
    const o = await loadOrder(id);
    const party = o.buyerId === a.userId ? "BUYER" : o.store.merchant.userId === a.userId ? "SELLER" : null;
    if (!party) throw forbidden();
    if (o.dispute) throw conflict("DISPUTE_EXISTS", "A dispute is already open for this order.");
    if (!["FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED", "DISPUTED"].includes(o.state)) throw badRequest("WRONG_STATE", "This order cannot be disputed.");
    const d = await prisma.dispute.create({
      data: {
        orderId: id,
        openedBy: party,
        reason,
        evidenceDeadline: new Date(Date.now() + 5 * 86400_000),
        evidence: { create: { authorId: a.userId, party, content: reason, hash: keccak256(toHex(reason)) } },
      },
    });
    const other = party === "BUYER" ? o.store.merchant.userId : o.buyerId;
    await notify(prisma, other, { kind: "dispute.opened", title: "A dispute was opened", body: `${o.product.title}: funds stay in escrow until it is resolved.`, href: `/orders/${id}` });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "dispute.open", target: id });
    return { id: d.id, evidenceHash: keccak256(toHex(reason)) };
  }

  @Post("disputes/:id/evidence")
  async evidence(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { content } = parse(z.object({ content: z.string().trim().min(3).max(4000) }), body);
    const d = await prisma.dispute.findUnique({ where: { id }, include: { order: { include: { store: { include: { merchant: true } } } } } });
    if (!d) throw notFound("Dispute");
    const party = d.order.buyerId === a.userId ? "BUYER" : d.order.store.merchant.userId === a.userId ? "SELLER" : null;
    if (!party) throw forbidden();
    if (d.evidenceDeadline < new Date()) throw badRequest("EVIDENCE_CLOSED", "The evidence period has ended.");
    const hash = keccak256(toHex(content));
    await prisma.disputeEvidence.create({ data: { disputeId: id, authorId: a.userId, party, content, hash } });
    return { ok: true, evidenceHash: hash };
  }

  @Get("disputes/:id")
  async disputeView(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    const d = await prisma.dispute.findUnique({ where: { id }, include: { evidence: { orderBy: { createdAt: "asc" } }, order: { include: { store: { include: { merchant: true } } } } } });
    if (!d) throw notFound("Dispute");
    const allowed = d.order.buyerId === a.userId || d.order.store.merchant.userId === a.userId || a.role === "ADMIN";
    if (!allowed) throw forbidden();
    return { ...d, order: undefined, evidence: d.evidence.map((e) => ({ id: e.id, party: e.party, content: e.content, hash: e.hash, createdAt: e.createdAt })) };
  }

  /** Reviews only for settled orders, one per order. */
  @Post("orders/:id/review")
  async review(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    const { rating, body: text } = parse(z.object({ rating: z.number().int().min(1).max(5), body: z.string().trim().min(3).max(2000) }), body);
    const o = await loadOrder(id);
    if (o.buyerId !== a.userId) throw forbidden();
    if (o.state !== "RELEASED") throw badRequest("NOT_SETTLED", "You can review once the order has settled.");
    const r = await prisma.review.create({ data: { orderId: id, productId: o.productId, authorId: a.userId, rating, body: text } });
    return r;
  }
}
