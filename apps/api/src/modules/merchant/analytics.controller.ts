import { Controller, Get, Param } from "@nestjs/common";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { ownedStore } from "./merchant.controller";

const PAID = ["FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED", "RELEASED", "DISPUTED", "REFUNDED"] as const;
const OPEN = ["FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED", "DISPUTED"] as const;

/** Merchant analytics computed from confirmed orders only. No estimates, no placeholders. */
@Controller("merchant/stores/:id/analytics")
@Auth()
export class AnalyticsController {
  @Get()
  async get(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    await ownedStore(a, id);
    const orders = await prisma.order.findMany({
      where: { storeId: id, state: { in: [...PAID] } },
      select: { state: true, totalCents: true, feeBps: true, productId: true, quantity: true, agentId: true, quoteId: true, createdAt: true },
    });
    const quotes = await prisma.order.count({ where: { storeId: id } });
    const negotiated = await prisma.checkoutQuote.findMany({ where: { id: { in: orders.map((o) => o.quoteId) }, negotiationId: { not: null } }, select: { id: true } });
    const negSet = new Set(negotiated.map((q) => q.id));

    const sum = (xs: typeof orders) => xs.reduce((n, o) => n + o.totalCents, 0);
    const released = orders.filter((o) => o.state === "RELEASED");
    const refunded = orders.filter((o) => o.state === "REFUNDED");
    const open = orders.filter((o) => (OPEN as readonly string[]).includes(o.state));
    const fees = released.reduce((n, o) => n + Math.floor((o.totalCents * o.feeBps) / 10_000), 0);

    const byProduct = new Map<string, { units: number; revenueCents: number }>();
    for (const o of orders.filter((o) => o.state !== "REFUNDED")) {
      const cur = byProduct.get(o.productId) ?? { units: 0, revenueCents: 0 };
      cur.units += o.quantity;
      cur.revenueCents += o.totalCents;
      byProduct.set(o.productId, cur);
    }
    const products = await prisma.product.findMany({ where: { id: { in: [...byProduct.keys()] } }, select: { id: true, title: true } });

    // Daily settled + gross for the last 30 days
    const days: { date: string; grossCents: number; settledCents: number }[] = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      days.push({ date: d, grossCents: 0, settledCents: 0 });
    }
    const idx = new Map(days.map((d, i) => [d.date, i]));
    for (const o of orders) {
      const i = idx.get(o.createdAt.toISOString().slice(0, 10));
      if (i === undefined) continue;
      if (o.state !== "REFUNDED") days[i].grossCents += o.totalCents;
      if (o.state === "RELEASED") days[i].settledCents += o.totalCents;
    }

    return {
      grossSalesCents: sum(orders.filter((o) => o.state !== "REFUNDED")),
      settledSalesCents: sum(released),
      netSettledCents: sum(released) - fees,
      outstandingEscrowCents: sum(open),
      completedOrders: released.length,
      paidOrders: orders.length,
      checkoutsStarted: quotes,
      conversionRate: quotes ? orders.length / quotes : null,
      agentOrders: orders.filter((o) => o.agentId).length,
      negotiatedOrders: orders.filter((o) => negSet.has(o.quoteId)).length,
      feesCents: fees,
      refunds: { count: refunded.length, cents: sum(refunded) },
      products: products.map((p) => ({ id: p.id, title: p.title, ...byProduct.get(p.id)! })).sort((x, y) => y.revenueCents - x.revenueCents),
      daily: days,
    };
  }
}
