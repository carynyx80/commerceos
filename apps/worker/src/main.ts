import { randomUUID } from "node:crypto";
import { claimJobs, completeJob, failJob, prisma } from "@commerce-os/database";
import { enabledChains, expireUnpaidOrders } from "@commerce-os/commerce";
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

const MAX_CONCURRENT = 4;
let inFlight = 0;

/**
 * Claim only as many jobs as there are free slots and do not wait for them to finish, so a
 * long agent turn never blocks the short jobs it depends on (e.g. the seller agent's reply).
 */
async function runJobs() {
  const free = MAX_CONCURRENT - inFlight;
  if (free <= 0) return;
  const jobs = await claimJobs(prisma, workerId, Object.keys(all), free);
  for (const job of jobs) {
    inFlight++;
    const timeoutMs = job.kind.startsWith("agent.") ? 180_000 : 90_000;
    void (async () => {
      try {
        await Promise.race([all[job.kind](job, log), new Promise((_, rej) => setTimeout(() => rej(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs))]);
        await completeJob(prisma, job.id);
      } catch (e) {
        const final = await failJob(prisma, job, e).catch(() => false);
        log(`job ${job.kind} ${job.id} failed (attempt ${job.attempts}${final ? ", giving up" : ""}): ${(e as Error).message}`);
      } finally {
        inFlight--;
      }
    })();
  }
}

async function main() {
  log(`starting (chains ${enabledChains().join(", ")})`);
  let lastExpire = 0;
  while (!stopping) {
    for (const chainId of enabledChains()) await tick(`indexer:${chainId}`, () => indexOnce(chainId, log));
    await tick("jobs", runJobs);
    if (Date.now() - lastExpire > 30_000) {
      lastExpire = Date.now();
      await tick("expiry", () => expireUnpaidOrders());
      await tick("devfeed", () => refreshDevPriceFeed(log));
    }
    await new Promise((r) => setTimeout(r, inFlight > 0 ? 500 : Number(process.env.POLL_MS ?? 2000)));
  }
  while (inFlight > 0) await new Promise((r) => setTimeout(r, 250));
  await prisma.$disconnect();
}

for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => ((stopping = true), log("stopping after current tick")));
void main();
