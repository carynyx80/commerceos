import { Body, Controller, Delete, Get, Param, Patch, Post } from "@nestjs/common";
import { audit, enqueueJob } from "@commerce-os/database";
import { createStoreSchema, productSchema, updateStoreSchema } from "@commerce-os/shared";
import { getAddress } from "viem";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { badRequest, conflict, forbidden, notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { productCard, productInclude } from "../catalog/serialize";

function slugify(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "item";
}

/** Load a store and confirm the caller owns it. */
export async function ownedStore(a: AuthContext, storeId: string) {
  const s = await prisma.store.findUnique({ where: { id: storeId }, include: { merchant: true } });
  if (!s) throw notFound("Store");
  if (s.merchant.userId !== a.userId) throw forbidden("You do not manage this store.");
  return s;
}

@Controller("merchant")
@Auth()
export class MerchantController {
  @Get("stores")
  async stores(@CurrentUser() a: AuthContext) {
    const m = await prisma.merchant.findUnique({ where: { userId: a.userId }, include: { stores: { orderBy: { createdAt: "asc" } } } });
    return { merchant: m && { id: m.id, verified: m.verified }, stores: m?.stores ?? [] };
  }

  @Post("stores")
  async createStore(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const input = parse(createStoreSchema, body);
    if (await prisma.store.findUnique({ where: { slug: input.slug } })) throw conflict("SLUG_TAKEN", "That store address is taken.");
    const merchant = await prisma.merchant.upsert({ where: { userId: a.userId }, create: { userId: a.userId }, update: {} });
    const store = await prisma.store.create({
      data: { ...input, payoutAddress: getAddress(input.payoutAddress), merchantId: merchant.id },
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "store.create", target: store.id });
    // Register the payout wallet in the on-chain MerchantRegistry so the escrow will pay it.
    await enqueueJob(prisma, "registry.sync", { storeId: store.id }, { maxAttempts: 8 });
    return store;
  }

  @Patch("stores/:id")
  async updateStore(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    await ownedStore(a, id);
    const input = parse(updateStoreSchema, body);
    const store = await prisma.store.update({
      where: { id },
      data: { ...input, payoutAddress: input.payoutAddress ? getAddress(input.payoutAddress) : undefined },
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "store.update", target: id, data: Object.keys(input) });
    if (input.payoutAddress) await enqueueJob(prisma, "registry.sync", { storeId: id }, { maxAttempts: 8 });
    return store;
  }

  @Get("stores/:id/products")
  async products(@CurrentUser() a: AuthContext, @Param("id") id: string) {
    await ownedStore(a, id);
    const rows = await prisma.product.findMany({ where: { storeId: id, status: { not: "REMOVED" } }, orderBy: { createdAt: "desc" }, include: productInclude });
    // The owner may see their own floor prices.
    return { items: rows.map((p) => ({ ...productCard(p), status: p.status, floorPriceCents: p.floorPriceCents, description: p.description, specs: p.specs, shippingInfo: p.shippingInfo, inventory: p.inventory })) };
  }

  @Post("stores/:id/products")
  async createProduct(@CurrentUser() a: AuthContext, @Param("id") id: string, @Body() body: unknown) {
    await ownedStore(a, id);
    const input = parse(productSchema, body);
    if (input.floorPriceCents != null && input.floorPriceCents > input.priceCents) throw badRequest("FLOOR_ABOVE_PRICE", "Floor price cannot exceed the list price.");
    let slug = slugify(input.title);
    if (await prisma.product.findUnique({ where: { storeId_slug: { storeId: id, slug } } })) slug = `${slug}-${Date.now().toString(36)}`;
    const { inventory, ...rest } = input;
    const p = await prisma.product.create({
      data: { ...rest, slug, storeId: id, inventory: { create: { available: inventory } } },
      include: productInclude,
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "product.create", target: p.id });
    return productCard(p);
  }

  @Patch("products/:pid")
  async updateProduct(@CurrentUser() a: AuthContext, @Param("pid") pid: string, @Body() body: unknown) {
    const p = await prisma.product.findUnique({ where: { id: pid } });
    if (!p) throw notFound("Product");
    await ownedStore(a, p.storeId);
    if (p.status === "REMOVED") throw forbidden("This listing was removed by moderation.");
    const input = parse(productSchema.partial(), body);
    const price = input.priceCents ?? p.priceCents;
    const floor = input.floorPriceCents !== undefined ? input.floorPriceCents : p.floorPriceCents;
    if (floor != null && floor > price) throw badRequest("FLOOR_ABOVE_PRICE", "Floor price cannot exceed the list price.");
    const { inventory, ...rest } = input;
    const updated = await prisma.$transaction(async (tx) => {
      if (inventory !== undefined) {
        const inv = await tx.inventory.findUnique({ where: { productId: pid } });
        if (inv && inventory < inv.reserved) throw badRequest("BELOW_RESERVED", `${inv.reserved} units are reserved by open orders.`);
        await tx.inventory.upsert({ where: { productId: pid }, create: { productId: pid, available: inventory }, update: { available: inventory } });
      }
      return tx.product.update({ where: { id: pid }, data: rest, include: productInclude });
    });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "product.update", target: pid, data: Object.keys(input) });
    return productCard(updated);
  }

  @Delete("products/:pid")
  async archive(@CurrentUser() a: AuthContext, @Param("pid") pid: string) {
    const p = await prisma.product.findUnique({ where: { id: pid } });
    if (!p) throw notFound("Product");
    await ownedStore(a, p.storeId);
    await prisma.product.update({ where: { id: pid }, data: { status: "ARCHIVED" } });
    await audit(prisma, { actorId: a.userId, actorType: "user", action: "product.archive", target: pid });
    return { ok: true };
  }
}
