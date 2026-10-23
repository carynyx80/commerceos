import { CanActivate, ExecutionContext, Inject, Injectable, SetMetadata, createParamDecorator } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { createHash, timingSafeEqual } from "node:crypto";
import type { Request } from "express";
import { prisma } from "./prisma";
import { AppError, forbidden, unauthorized } from "./errors";
import { config } from "../config";

export const SESSION_COOKIE = "cos_session";
export const CSRF_COOKIE = "cos_csrf";

export interface AuthContext {
  userId: string;
  sessionId: string;
  address: string;
  role: "USER" | "ADMIN";
  csrfToken: string;
}
declare module "express" {
  interface Request {
    auth?: AuthContext;
    id?: string;
  }
}

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex");

const AUTH_KEY = "cos:auth";
/** Route requires a signed-in user. `"admin"` additionally requires the ADMIN role. */
export const Auth = (level: "user" | "admin" = "user") => SetMetadata(AUTH_KEY, level);
export const CurrentUser = createParamDecorator((_: unknown, ctx: ExecutionContext) => ctx.switchToHttp().getRequest<Request>().auth);

const SAFE = new Set(["GET", "HEAD", "OPTIONS"]);

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Loads the session for every request. Any state-changing request made with a session
 * cookie must also carry the matching CSRF header (double-submit, bound to the session)
 * and, when the browser sends one, an allowed Origin.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(Reflector) private reflector: Reflector) {}

  async canActivate(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest<Request>();
    const level = this.reflector.getAllAndOverride<"user" | "admin" | undefined>(AUTH_KEY, [ctx.getHandler(), ctx.getClass()]);
    const token: string | undefined = req.cookies?.[SESSION_COOKIE];

    if (token) {
      const s = await prisma.session.findUnique({ where: { id: hashToken(token) }, include: { user: true } });
      if (s && !s.revokedAt && s.expiresAt > new Date() && !s.user.suspended) {
        req.auth = { userId: s.userId, sessionId: s.id, address: s.address, role: s.user.role, csrfToken: s.csrfToken };
        if (Date.now() - s.lastSeenAt.getTime() > 5 * 60_000) {
          void prisma.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
        }
      }
    }

    if (!SAFE.has(req.method) && req.auth) {
      const origin = req.headers.origin;
      if (origin && !config.appOrigins.includes(origin)) throw new AppError(403, "BAD_ORIGIN", "Request origin not allowed.");
      const header = req.headers["x-csrf-token"];
      if (typeof header !== "string" || !safeEqual(header, req.auth.csrfToken)) {
        throw new AppError(403, "CSRF", "Missing or invalid CSRF token.");
      }
    }

    if (!level) return true;
    if (!req.auth) throw unauthorized();
    if (level === "admin" && req.auth.role !== "ADMIN") throw forbidden("Administrator access required.");
    return true;
  }
}
