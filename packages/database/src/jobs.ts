import type { Prisma, PrismaClient, Job } from "@prisma/client";

type Db = PrismaClient | Prisma.TransactionClient;

/** Enqueue a job. With an idempotency key the same work is only queued once. */
export async function enqueueJob(
  db: Db,
  kind: string,
  payload: Prisma.InputJsonValue,
  opts: { idempotencyKey?: string; runAt?: Date; maxAttempts?: number } = {},
): Promise<Job> {
  if (opts.idempotencyKey) {
    const existing = await db.job.findUnique({ where: { idempotencyKey: opts.idempotencyKey } });
    if (existing) return existing;
  }
  return db.job.create({
    data: { kind, payload, idempotencyKey: opts.idempotencyKey, runAt: opts.runAt ?? new Date(), maxAttempts: opts.maxAttempts ?? 3 },
  });
}

/**
 * Claim up to `limit` due jobs with SKIP LOCKED so several workers never take the same
 * job. Jobs left RUNNING by a crashed worker are reclaimed after `staleMs`.
 */
export async function claimJobs(db: PrismaClient, workerId: string, kinds: string[], limit = 5, staleMs = 5 * 60_000): Promise<Job[]> {
  // Prisma stores timestamps as UTC without zone, so compare against app-supplied UTC instants, not now().
  const now = new Date();
  const staleBefore = new Date(now.getTime() - staleMs);
  return db.$queryRaw<Job[]>`
    UPDATE "Job" SET status = 'RUNNING', "lockedAt" = ${now}, "lockedBy" = ${workerId}, attempts = attempts + 1, "updatedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "Job"
      WHERE kind = ANY(${kinds}::text[])
        AND ((status = 'QUEUED' AND "runAt" <= ${now})
          OR (status = 'RUNNING' AND "lockedAt" < ${staleBefore}))
      ORDER BY "runAt" ASC
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *`;
}

export async function completeJob(db: Db, id: string) {
  await db.job.update({ where: { id }, data: { status: "DONE", lockedAt: null, lockedBy: null } });
}

/** Retry with exponential backoff until maxAttempts, then mark FAILED. */
export async function failJob(db: Db, job: Job, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  const final = job.attempts >= job.maxAttempts;
  await db.job.update({
    where: { id: job.id },
    data: {
      status: final ? "FAILED" : "QUEUED",
      lastError: msg.slice(0, 2000),
      lockedAt: null,
      lockedBy: null,
      runAt: final ? undefined : new Date(Date.now() + Math.min(60_000, 2_000 * 2 ** job.attempts)),
    },
  });
  return final;
}
