import { PrismaClient } from "@prisma/client";

export * from "@prisma/client";

const g = globalThis as unknown as { __cosPrisma?: PrismaClient };
/** One client per process (survives hot reload in dev). */
export const prisma: PrismaClient = g.__cosPrisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });
if (process.env.NODE_ENV !== "production") g.__cosPrisma = prisma;

export { enqueueJob, claimJobs, completeJob, failJob } from "./jobs";
export { audit } from "./audit";
export { notify } from "./notify";
