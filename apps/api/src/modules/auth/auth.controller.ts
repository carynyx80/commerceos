import { Body, Controller, Get, HttpCode, Post, Req, Res } from "@nestjs/common";
import type { Request, Response } from "express";
import { randomBytes } from "node:crypto";
import { createPublicClient, getAddress, http, verifyMessage, type Hex } from "viem";
import { parseSiweMessage, validateSiweMessage } from "viem/siwe";
import { z } from "zod";
import { chainById } from "@commerce-os/blockchain";
import { enabledChains, rpcUrlFor } from "@commerce-os/commerce";
import { audit } from "@commerce-os/database";
import { prisma } from "../../common/prisma";
import { Auth, CSRF_COOKIE, CurrentUser, SESSION_COOKIE, hashToken, type AuthContext } from "../../common/auth";
import { badRequest, unauthorized } from "../../common/errors";
import { parse } from "../../common/zod";
import { config } from "../../config";

const verifySchema = z.object({ message: z.string().max(4000), signature: z.string().regex(/^0x[0-9a-fA-F]+$/) });

@Controller("auth")
export class AuthController {
  /** One-time nonce, valid 10 minutes, consumed by /verify. */
  @Post("nonce")
  @HttpCode(200)
  async nonce() {
    const nonce = randomBytes(16).toString("hex");
    await prisma.authNonce.create({ data: { nonce, expiresAt: new Date(Date.now() + 10 * 60_000) } });
    return { nonce };
  }

  @Post("verify")
  @HttpCode(200)
  async verify(@Body() body: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const { message, signature } = parse(verifySchema, body);
    const fields = parseSiweMessage(message);
    if (!fields.address || !fields.nonce || !fields.domain) throw badRequest("SIWE_INVALID", "Malformed sign-in message.");

    const allowedDomains = config.appOrigins.map((o) => new URL(o).host);
    const domainOk = allowedDomains.includes(fields.domain);
    if (!domainOk) throw badRequest("SIWE_DOMAIN", "Sign-in message was created for a different site.");
    if (!fields.chainId || !enabledChains().includes(fields.chainId)) throw badRequest("SIWE_CHAIN", `Sign in on one of chains ${enabledChains().join(", ")}.`);
    if (!validateSiweMessage({ message: fields, time: new Date() })) throw badRequest("SIWE_EXPIRED", "Sign-in message expired.");

    // Consume the nonce atomically: a replayed signature finds it already used.
    const consumed = await prisma.authNonce.updateMany({
      where: { nonce: fields.nonce, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (consumed.count !== 1) throw unauthorized("Sign-in nonce is invalid, expired, or already used.");

    const address = getAddress(fields.address);
    let valid = false;
    try {
      valid = await verifyMessage({ address, message, signature: signature as Hex });
    } catch {
      valid = false;
    }
    if (!valid) {
      // Smart-contract wallets (ERC-1271 / ERC-6492) need an on-chain check on the chain they signed for.
      const client = createPublicClient({ chain: chainById(fields.chainId), transport: http(rpcUrlFor(fields.chainId)) });
      valid = await client.verifyMessage({ address, message, signature: signature as Hex }).catch(() => false);
    }
    if (!valid) throw unauthorized("Signature does not match the wallet.");

    const lower = address.toLowerCase();
    const wallet = await prisma.wallet.findUnique({ where: { address: lower } });
    const user = wallet
      ? await prisma.user.findUniqueOrThrow({ where: { id: wallet.userId } })
      : await prisma.user.create({ data: { wallets: { create: { address: lower } } } });
    if (user.suspended) throw unauthorized("This account is suspended.");
    if (config.adminAddresses.includes(lower) && user.role !== "ADMIN") {
      await prisma.user.update({ where: { id: user.id }, data: { role: "ADMIN" } });
    }

    const token = randomBytes(32).toString("base64url");
    const csrfToken = randomBytes(24).toString("base64url");
    const maxAge = config.sessionTtlHours * 3600_000;
    await prisma.session.create({
      data: {
        id: hashToken(token),
        userId: user.id,
        address: lower,
        chainId: fields.chainId,
        csrfToken,
        userAgent: req.headers["user-agent"]?.slice(0, 300),
        expiresAt: new Date(Date.now() + maxAge),
      },
    });
    await audit(prisma, { actorId: user.id, actorType: "user", action: "auth.sign_in", target: lower, ip: req.ip });

    const base = { sameSite: "lax" as const, secure: config.cookieSecure, path: "/", maxAge };
    res.cookie(SESSION_COOKIE, token, { ...base, httpOnly: true });
    res.cookie(CSRF_COOKIE, csrfToken, { ...base, httpOnly: false });
    return { ok: true };
  }

  @Post("logout")
  @HttpCode(200)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    if (req.auth) await prisma.session.update({ where: { id: req.auth.sessionId }, data: { revokedAt: new Date() } });
    res.clearCookie(SESSION_COOKIE, { path: "/" });
    res.clearCookie(CSRF_COOKIE, { path: "/" });
    return { ok: true };
  }

  @Get("me")
  @Auth()
  async me(@CurrentUser() auth: AuthContext) {
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: auth.userId },
      include: { merchant: { include: { stores: true } } },
    });
    return {
      id: user.id,
      address: auth.address,
      role: user.role,
      displayName: user.displayName,
      chainId: config.chainId,
      chains: enabledChains(),
      csrfToken: auth.csrfToken,
      merchant: user.merchant && {
        id: user.merchant.id,
        verified: user.merchant.verified,
        stores: user.merchant.stores.map((s) => ({ id: s.id, slug: s.slug, name: s.name, tagline: s.tagline, logoUrl: s.logoUrl, bannerUrl: s.bannerUrl, verified: user.merchant!.verified, isFixture: s.isFixture })),
      },
    };
  }
}
