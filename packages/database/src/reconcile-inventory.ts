/**
 * Recompute Inventory.reserved from live orders (unpaid quotes and paid-but-unsettled orders).
 * Safe to run any time; prints every product whose reservation changed. Usage:
 *   npx tsx --env-file=.env src/reconcile-inventory.ts [--dry-run]
 */
import { prisma } from "./index";

const HOLDING = ["AWAITING_PAYMENT", "FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED", "DISPUTED"] as const;
const dry = process.argv.includes("--dry-run");

const held = await prisma.order.groupBy({ by: ["productId"], where: { state: { in: [...HOLDING] } }, _sum: { quantity: true } });
const want = new Map(held.map((h) => [h.productId, h._sum.quantity ?? 0]));
for (const inv of await prisma.inventory.findMany({ include: { product: { select: { title: true } } } })) {
  const target = want.get(inv.productId) ?? 0;
  if (inv.reserved === target) continue;
  console.log(`${inv.product.title}: reserved ${inv.reserved} → ${target}`);
  if (!dry) await prisma.inventory.update({ where: { productId: inv.productId }, data: { reserved: target } });
}
await prisma.$disconnect();
