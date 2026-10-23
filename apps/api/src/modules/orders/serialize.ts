import type { Dispute, Order, OrderTransition, Payment, Product, Store } from "@commerce-os/database";

export function orderView(o: Order & { product: Product; store: Store; payments: Payment[]; transitions: OrderTransition[]; dispute: Dispute | null }) {
  return {
    id: o.id,
    onchainId: o.onchainId,
    state: o.state,
    quantity: o.quantity,
    unitCents: o.unitCents,
    totalCents: o.totalCents,
    feeBps: o.feeBps,
    asset: o.asset,
    chainId: o.chainId,
    amount: o.amount,
    buyerAddress: o.buyerAddress,
    sellerAddress: o.sellerAddress,
    paymentDeadline: o.paymentDeadline.toISOString(),
    createdAt: o.createdAt.toISOString(),
    trackingInfo: o.trackingInfo,
    byAgent: Boolean(o.agentId),
    product: { id: o.product.id, title: o.product.title, images: o.product.images, deliveryType: o.product.deliveryType },
    store: { id: o.store.id, slug: o.store.slug, name: o.store.name },
    payments: o.payments.map((p) => ({ txHash: p.txHash, status: p.status, chainId: p.chainId })),
    transitions: o.transitions.map((t) => ({ from: t.from, to: t.to, source: t.source, txHash: t.txHash, createdAt: t.createdAt.toISOString() })),
    dispute: o.dispute && { id: o.dispute.id, status: o.dispute.status, reason: o.dispute.reason },
  };
}

export const orderInclude = {
  product: true,
  store: true,
  payments: { orderBy: { createdAt: "asc" } },
  transitions: { orderBy: { createdAt: "asc" } },
  dispute: true,
} as const;
