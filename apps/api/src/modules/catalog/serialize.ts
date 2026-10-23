import type { Inventory, Merchant, Product, Store } from "@commerce-os/database";

type ProductRow = Product & { inventory: Inventory | null; store: Store & { merchant: Merchant } };

export function storeSummary(s: Store & { merchant: Merchant }) {
  return {
    id: s.id,
    slug: s.slug,
    name: s.name,
    tagline: s.tagline,
    logoUrl: s.logoUrl,
    bannerUrl: s.bannerUrl,
    verified: s.merchant.verified,
    isFixture: s.isFixture,
  };
}

/** Public product shape. Never includes the seller's floor price. */
export function productCard(p: ProductRow, rating?: { average: number; count: number } | null) {
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    category: p.category,
    priceCents: p.priceCents,
    images: p.images,
    acceptedAssets: p.acceptedAssets,
    negotiable: p.negotiable,
    deliveryType: p.deliveryType,
    available: Math.max(0, (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0)),
    isFixture: p.isFixture,
    featured: p.featured,
    createdAt: p.createdAt.toISOString(),
    store: storeSummary(p.store),
    rating: rating ?? null,
  };
}

export const productInclude = { inventory: true, store: { include: { merchant: true } } } as const;
