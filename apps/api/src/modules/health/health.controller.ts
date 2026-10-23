import { Controller, Get } from "@nestjs/common";
import { deploymentFor } from "@commerce-os/blockchain";
import { prisma } from "../../common/prisma";
import { config } from "../../config";

@Controller("health")
export class HealthController {
  @Get()
  async health() {
    let db = false;
    try {
      await prisma.$queryRaw`SELECT 1`;
      db = true;
    } catch {
      db = false;
    }
    const cursor = await prisma.indexerCursor.findUnique({ where: { id: `escrow:${config.chainId}` } }).catch(() => null);
    const lastJob = await prisma.job.findFirst({ where: { status: "DONE" }, orderBy: { updatedAt: "desc" } }).catch(() => null);
    return {
      ok: db,
      database: db,
      chainId: config.chainId,
      contracts: Boolean(deploymentFor(config.chainId)),
      quoteSigner: Boolean(config.quoteSignerKey),
      ai: config.openaiConfigured ? "configured" : "missing OPENAI_API_KEY",
      indexer: cursor ? { block: cursor.blockNumber.toString(), updatedAt: cursor.updatedAt } : null,
      worker: lastJob ? { lastJobAt: lastJob.updatedAt } : null,
    };
  }
}
