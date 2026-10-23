import { Controller, Get, Inject, Param, Query } from "@nestjs/common";
import { searchSchema } from "@commerce-os/shared";
import { prisma } from "../../common/prisma";
import { notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { CatalogService, ratingsFor } from "./catalog.service";
import { productCard, productInclude, storeSummary } from "./serialize";

@Controller()
export class CatalogController {
  constructor(@Inject(CatalogService) private catalog: CatalogService) {}

  @Get("catalog/search")
  search(@Query() q: Record<string, string>) {
    return this.catalog.search(parse(searchSchema, q));
  }

  @Get("catalog/categories")
  categories() {
    return this.catalog.categories();
  }

  @Get("catalog/featured")
  async featured() {
    const rows = await prisma.product.findMany({
      where: { status: "ACTIVE", store: { active: true } },
      orderBy: [{ featured: "desc" }, { createdAt: "desc" }],
      take: 8,
      include: productInclude,
    });
    const ratings = await ratingsFor(rows.map((r) => r.id));
    return { items: rows.map((p) => productCard(p, ratings.get(p.id))) };
  }

  @Get("catalog/products/:id")
  async product(@Param("id") id: string) {
    const p = await prisma.product.findFirst({
      where: { id, status: { in: ["ACTIVE", "ARCHIVED"] } },
      include: { ...productInclude, reviews: { orderBy: { createdAt: "desc" }, take: 20, include: { author: { include: { wallets: true } } } } },
    });
    if (!p) throw notFound("Product");
    const ratings = await ratingsFor([p.id]);
    return {
      ...productCard(p, ratings.get(p.id)),
      description: p.description,
      specs: p.specs,
      shippingInfo: p.shippingInfo,
      status: p.status,
      store: { ...storeSummary(p.store), returnPolicy: p.store.returnPolicy, description: p.store.description, payoutAddress: p.store.payoutAddress },
      reviews: p.reviews.map((r) => ({
        id: r.id,
        rating: r.rating,
        body: r.body,
        createdAt: r.createdAt.toISOString(),
        author: r.author.displayName ?? (r.author.wallets[0] ? `${r.author.wallets[0].address.slice(0, 6)}…${r.author.wallets[0].address.slice(-4)}` : "Buyer"),
      })),
    };
  }

  @Get("stores/trending")
  async trending() {
    // Rank by settled orders in the last 30 days, then by listing count.
    const since = new Date(Date.now() - 30 * 86400_000);
    const stores = await prisma.store.findMany({
      where: { active: true },
      include: { merchant: true, _count: { select: { products: { where: { status: "ACTIVE" } }, orders: { where: { state: "RELEASED", updatedAt: { gte: since } } } } } },
      take: 60,
    });
    stores.sort((a, b) => b._count.orders - a._count.orders || b._count.products - a._count.products);
    return { items: stores.map((s) => ({ ...storeSummary(s), payoutAddress: s.payoutAddress, productCount: s._count.products })) };
  }

  @Get("stores/:slug")
  async store(@Param("slug") slug: string) {
    const s = await prisma.store.findUnique({
      where: { slug },
      include: {
        merchant: true,
        products: { where: { status: "ACTIVE" }, orderBy: [{ featured: "desc" }, { createdAt: "desc" }], include: productInclude },
        _count: { select: { orders: { where: { state: "RELEASED" } } } },
      },
    });
    if (!s || !s.active) throw notFound("Store");
    const ratings = await ratingsFor(s.products.map((p) => p.id));
    const reviews = await prisma.review.findMany({ where: { product: { storeId: s.id } }, orderBy: { createdAt: "desc" }, take: 12, include: { product: true } });
    const all = [...ratings.values()];
    const count = all.reduce((n, r) => n + r.count, 0);
    return {
      ...storeSummary(s),
      description: s.description,
      returnPolicy: s.returnPolicy,
      payoutAddress: s.payoutAddress,
      createdAt: s.createdAt.toISOString(),
      settledOrders: s._count.orders,
      rating: count ? { average: all.reduce((n, r) => n + r.average * r.count, 0) / count, count } : null,
      products: s.products.map((p) => productCard(p, ratings.get(p.id))),
      reviews: reviews.map((r) => ({ id: r.id, rating: r.rating, body: r.body, createdAt: r.createdAt.toISOString(), product: r.product.title })),
    };
  }

  /** Marketplace figures, counted from the database only. */
  @Get("stats")
  async stats() {
    const [products, stores, realStores, released, activeAgents] = await Promise.all([
      prisma.product.count({ where: { status: "ACTIVE", store: { active: true } } }),
      prisma.store.count({ where: { active: true } }),
      prisma.store.count({ where: { active: true, isFixture: false } }),
      prisma.order.aggregate({ where: { state: "RELEASED" }, _sum: { totalCents: true }, _count: true }),
      prisma.agent.count({ where: { status: "ACTIVE" } }),
    ]);
    return {
      products,
      stores,
      ordersSettled: released._count,
      settledVolumeCents: released._sum.totalCents ?? 0,
      activeAgents,
      fixtureOnly: stores > 0 && realStores === 0,
    };
  }
}
