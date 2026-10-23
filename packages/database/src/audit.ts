import type { Prisma, PrismaClient } from "@prisma/client";

export async function audit(
  db: PrismaClient | Prisma.TransactionClient,
  e: { actorId?: string | null; actorType: "user" | "admin" | "agent" | "system"; action: string; target?: string; data?: Prisma.InputJsonValue; ip?: string },
) {
  await db.auditLog.create({ data: { ...e, actorId: e.actorId ?? null } });
}
