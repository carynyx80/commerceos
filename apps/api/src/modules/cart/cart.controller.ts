import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Put } from "@nestjs/common";
import { z } from "zod";
import { cartItemSchema } from "@commerce-os/shared";
import { prisma } from "../../common/prisma";
import { Auth, CurrentUser, type AuthContext } from "../../common/auth";
import { badRequest, notFound } from "../../common/errors";
import { parse } from "../../common/zod";
import { ratingsFor } from "../catalog/catalog.service";
import { productCard, productInclude } from "../catalog/serialize";

@Controller()
@Auth()
export class CartController {
  @Get("cart")
  async get(@CurrentUser() a: AuthContext) {
    const cart = await prisma.cart.findUnique({
      where: { userId: a.userId },
      include: { items: { orderBy: { id: "asc" }, include: { product: { include: productInclude } } } },
    });
    const items = cart?.items.filter((i) => i.product.status === "ACTIVE") ?? [];
    const ratings = await ratingsFor(items.map((i) => i.productId));
    return { lines: items.map((i) => ({ productId: i.productId, quantity: i.quantity, product: productCard(i.product, ratings.get(i.productId)) })) };
  }

  @Post("cart/items")
  @HttpCode(200)
  async add(@CurrentUser() a: AuthContext, @Body() body: unknown) {
    const { productId, quantity } = parse(cartItemSchema, body);
    const p = await prisma.product.findFirst({ where: { id: productId, status: "ACTIVE" }, include: { inventory: true } });
    if (!p) throw notFound("Product");
    const cart = await prisma.cart.upsert({ where: { userId: a.userId }, create: { userId: a.userId }, update: {} });
    const existing = await prisma.cartItem.findUnique({ where: { cartId_productId: { cartId: cart.id, productId } } });
    const next = Math.min(99, (existing?.quantity ?? 0) + quantity);
    const available = (p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0);
    if (next > available) throw badRequest("INSUFFICIENT_STOCK", `Only ${Math.max(0, available)} available.`);
    await prisma.cartItem.upsert({
      where: { cartId_productId: { cartId: cart.id, productId } },
      create: { cartId: cart.id, productId, quantity: next },
      update: { quantity: next },
    });
    return { ok: true };
  }

  @Patch("cart/items/:productId")
  async setQty(@CurrentUser() a: AuthContext, @Param("productId") productId: string, @Body() body: unknown) {
    const { quantity } = parse(z.object({ quantity: z.number().int().min(1).max(99) }), body);
    const cart = await prisma.cart.findUnique({ where: { userId: a.userId } });
    if (!cart) throw notFound("Cart item");
    await prisma.cartItem.update({ where: { cartId_productId: { cartId: cart.id, productId } }, data: { quantity } });
    return { ok: true };
  }

  @Delete("cart/items/:productId")
  async remove(@CurrentUser() a: AuthContext, @Param("productId") productId: string) {
    const cart = await prisma.cart.findUnique({ where: { userId: a.userId } });
    if (cart) await prisma.cartItem.deleteMany({ where: { cartId: cart.id, productId } });
    return { ok: true };
  }

  @Get("saved/ids")
  async savedIds(@CurrentUser() a: AuthContext) {
    const rows = await prisma.savedProduct.findMany({ where: { userId: a.userId }, select: { productId: true } });
    return { ids: rows.map((r) => r.productId) };
  }

  @Get("saved")
  async saved(@CurrentUser() a: AuthContext) {
    const rows = await prisma.savedProduct.findMany({ where: { userId: a.userId }, orderBy: { createdAt: "desc" }, include: { product: { include: productInclude } } });
    const ratings = await ratingsFor(rows.map((r) => r.productId));
    return { items: rows.filter((r) => r.product.status === "ACTIVE").map((r) => productCard(r.product, ratings.get(r.productId))) };
  }

  @Put("saved/:productId")
  async save(@CurrentUser() a: AuthContext, @Param("productId") productId: string) {
    const p = await prisma.product.findUnique({ where: { id: productId } });
    if (!p) throw notFound("Product");
    await prisma.savedProduct.upsert({ where: { userId_productId: { userId: a.userId, productId } }, create: { userId: a.userId, productId }, update: {} });
    return { ok: true };
  }

  @Delete("saved/:productId")
  async unsave(@CurrentUser() a: AuthContext, @Param("productId") productId: string) {
    await prisma.savedProduct.deleteMany({ where: { userId: a.userId, productId } });
    return { ok: true };
  }
}
