import type { Prisma, PrismaClient } from "@prisma/client";

export async function notify(
  db: PrismaClient | Prisma.TransactionClient,
  userId: string,
  n: { kind: string; title: string; body: string; href?: string },
) {
  await db.notification.create({ data: { userId, ...n } });
}
