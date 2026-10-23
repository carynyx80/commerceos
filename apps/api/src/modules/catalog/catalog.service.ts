import { Injectable } from "@nestjs/common";
import { Prisma } from "@commerce-os/database";
import type { SearchInput } from "@commerce-os/shared";
import { prisma } from "../../common/prisma";
import { productCard, productInclude } from "./serialize";

export async function ratingsFor(productIds: string[]) {
  if (!productIds.length) return new Map<string, { average: number; count: number }>();
  const rows = await prisma.review.groupBy({ by: ["productId"], where: { productId: { in: productIds } }, _avg: { rating: true }, _count: true });
  return new Map(rows.map((r) => [r.productId, { average: r._avg.rating ?? 0, count: r._count }]));
}

/** Catalog search over live (ACTIVE) listings in active stores. Used by the UI and by agents. */
@Injectable()
export class CatalogService {
  async search(input: SearchInput) {
    const where: Prisma.ProductWhereInput = { status: "ACTIVE", store: { active: true } };
    const and: Prisma.ProductWhereInput[] = [];
    const q = input.q?.trim();
    if (q) {
      const terms = q.split(/\s+/).filter((t) => t.length > 1).slice(0, 8);
      for (const t of terms.length ? terms : [q]) {
        and.push({
          OR: [
            { title: { contains: t, mode: "insensitive" } },
            { description: { contains: t, mode: "insensitive" } },
            { category: { contains: t, mode: "insensitive" } },
            { store: { name: { contains: t, mode: "insensitive" } } },
          ],
        });
      }
    }
    if (input.category) and.push({ category: { equals: input.category, mode: "insensitive" } });
    if (input.store) and.push({ store: { slug: input.store } });
    if (input.minPrice !== undefined) and.push({ priceCents: { gte: input.minPrice } });
    if (input.maxPrice !== undefined) and.push({ priceCents: { lte: input.maxPrice } });
    if (input.asset) and.push({ acceptedAssets: { has: input.asset } });
    if (input.negotiable) and.push({ negotiable: true });
    if (input.inStock) and.push({ inventory: { available: { gt: 0 } } });
    if (and.length) where.AND = and;

    const orderBy: Prisma.ProductOrderByWithRelationInput[] =
      input.sort === "price_asc"
        ? [{ priceCents: "asc" }]
        : input.sort === "price_desc"
          ? [{ priceCents: "desc" }]
          : input.sort === "newest"
            ? [{ createdAt: "desc" }]
            : [{ featured: "desc" }, { createdAt: "desc" }];

    const offset = input.cursor ? Math.max(0, Number(Buffer.from(input.cursor, "base64url").toString()) || 0) : 0;
    const [rows, total] = await Promise.all([
      prisma.product.findMany({ where, orderBy: [...orderBy, { id: "asc" }], skip: offset, take: input.limit, include: productInclude }),
      prisma.product.count({ where }),
    ]);

    // Relevance: within the page, exact title hits rank above description hits.
    let items = rows;
    if (q && input.sort === "relevance") {
      const ql = q.toLowerCase();
      const score = (p: (typeof rows)[number]) => (p.title.toLowerCase().includes(ql) ? 2 : 0) + (p.featured ? 1 : 0);
      items = [...rows].sort((a, b) => score(b) - score(a));
    }
    const ratings = await ratingsFor(items.map((r) => r.id));
    const next = offset + rows.length < total ? Buffer.from(String(offset + rows.length)).toString("base64url") : null;
    return { items: items.map((p) => productCard(p, ratings.get(p.id))), total, nextCursor: next };
  }

  async categories() {
    const rows = await prisma.product.groupBy({ by: ["category"], where: { status: "ACTIVE", store: { active: true } }, _count: true, orderBy: { category: "asc" } });
    return rows.map((r) => ({ name: r.category, count: r._count }));
  }
}
