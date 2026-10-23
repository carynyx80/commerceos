import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from "@nestjs/common";
import { ZodError } from "zod";
import { Prisma } from "@commerce-os/database";
import { CommerceError } from "@commerce-os/commerce";

/** Domain error with a stable machine-readable code. */
export class AppError extends HttpException {
  constructor(status: number, public code: string, message: string, public details?: unknown) {
    super({ code, message, details }, status);
  }
}
export const badRequest = (code: string, msg: string, details?: unknown) => new AppError(400, code, msg, details);
export const unauthorized = (msg = "Sign in required.") => new AppError(401, "UNAUTHENTICATED", msg);
export const forbidden = (msg = "You do not have access to this resource.") => new AppError(403, "FORBIDDEN", msg);
export const notFound = (what = "Resource") => new AppError(404, "NOT_FOUND", `${what} not found.`);
export const conflict = (code: string, msg: string) => new AppError(409, code, msg);

@Catch()
export class ErrorFilter implements ExceptionFilter {
  private log = new Logger("Error");
  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    const req = host.switchToHttp().getRequest();
    const requestId = req?.id;
    if (err instanceof ZodError) {
      return res.status(400).json({ code: "VALIDATION", message: "Invalid input.", details: err.flatten(), requestId });
    }
    if (err instanceof CommerceError) {
      return res.status(err.status).json({ code: err.code, message: err.message, details: err.details, requestId });
    }
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      return res.status(409).json({ code: "DUPLICATE", message: "That already exists.", details: err.meta, requestId });
    }
    if (err instanceof HttpException) {
      const body = err.getResponse() as any;
      const status = err.getStatus();
      if (typeof body === "object" && body.code) return res.status(status).json({ ...body, requestId });
      return res.status(status).json({
        code: status === 429 ? "RATE_LIMITED" : HttpStatus[status] ?? "ERROR",
        message: typeof body === "string" ? body : (body?.message ?? err.message),
        requestId,
      });
    }
    this.log.error(`[${requestId}] ${(err as Error)?.stack ?? err}`);
    return res.status(500).json({ code: "INTERNAL", message: "Something went wrong on our side.", requestId });
  }
}
