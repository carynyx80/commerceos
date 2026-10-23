import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob, prisma } from "@commerce-os/database";
import { expireUnpaidOrders } from "@commerce-os/commerce";
import { indexOnce } from "./indexer";
import { handlers, refreshDevPriceFeed } from "./jobs";
import { agentHandlers } from "./agents";

/**
 * Commerce OS worker: blockchain indexer, durable job runner (Postgres SKIP LOCKED queue),
 * order expiry and agent task execution. Safe to run several instances.
 */
const workerId = `worker-${process.pid}-${randomUUID().slice(0, 8)}`;
const log = (m: string) => console.log(`${new Date().toISOString()} [${workerId}] ${m}`);
const all = { ...handlers, ...agentHandlers };
let stopping = false;

async function tick(name: string, fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    log(`${name} error: ${(e as Error).message}`);
  }
}

async function runJobs() {
  const jobs = await claimJobs(prisma, workerId, Object.keys(all), 4);
  await Promise.all(
    jobs.map(async (job) => {
      const timeoutMs = job.kind.startsWith("agent.") ? 180_000 : 90_000;
      try {
        await Promise.race([all[job.kind](job, log), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs))]);
        await completeJob(prisma, job.id);
      } catch (e) {
        const final = await failJob(prisma, job, e);
        log(`job ${job.kind} ${job.id} failed (attempt ${job.attempts}${final ? ", giving up" : ""}): ${(e as Error).message}`);
      }
    }),
  );
}

async function main() {
  log(`starting (chain ${process.env.CHAIN_ID})`);
  let lastExpire = 0;
  while (!stopping) {
    await tick("indexer", () => indexOnce(log));
    await tick("jobs", runJobs);
    if (Date.now() - lastExpire > 60_000) {
      lastExpire = Date.now();
      await tick("expiry", () => expireUnpaidOrders());
      await tick("devfeed", () => refreshDevPriceFeed(log));
    }
    await new Promise((r) => setTimeout(r, Number(process.env.POLL_MS ?? 2000)));
  }
  await prisma.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => ((stopping = true), log("stopping after current tick")));
void main();
