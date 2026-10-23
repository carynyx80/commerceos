import type { PrismaClient } from "@prisma/client";

export const FLAGS = { checkoutPaused: "checkout.paused", agentsPaused: "agents.paused" } as const;

export async function flag(db: PrismaClient, key: string): Promise<boolean> {
  const f = await db.systemFlag.findUnique({ where: { key } });
  return f?.value ?? false;
}
