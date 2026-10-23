import OpenAI from "openai";
import { AgentConfigError, PaymentRefused, executeAgentPayment, phraseSellerReply, runShoppingTurn } from "@commerce-os/agent-core";
import { sellerAgentRespond } from "@commerce-os/commerce";
import { notify, prisma, type Job } from "@commerce-os/database";

type Handler = (job: Job, log: (m: string) => void) => Promise<void>;

export const agentHandlers: Record<string, Handler> = {
  /** One assistant turn in the AI workspace. Durable: task state lives in Postgres. */
  async "agent.run"(job, log) {
    const { taskId } = job.payload as { taskId: string };
    const task = await prisma.agentTask.findUnique({ where: { id: taskId }, include: { conversation: true } });
    if (!task || !task.conversation || task.status === "SUCCEEDED" || task.status === "CANCELLED") return;
    await prisma.agentTask.update({ where: { id: taskId }, data: { status: "RUNNING" } });
    try {
      await runShoppingTurn({ taskId, conversationId: task.conversation.id, userId: task.conversation.userId, agentId: task.agentId, log });
      await prisma.agentTask.update({ where: { id: taskId }, data: { status: "SUCCEEDED", finishedAt: new Date(), step: "Done" } });
      await notify(prisma, task.conversation.userId, { kind: "agent.task_complete", title: "Your agent replied", body: task.conversation.title, href: `/workspace?c=${task.conversation.id}` });
    } catch (e) {
      const msg = (e as Error).message;
      // Config errors and OpenAI 4xx (other than rate limits) won't succeed on retry.
      const permanent = e instanceof AgentConfigError || (e instanceof OpenAI.APIError && typeof e.status === "number" && e.status >= 400 && e.status < 500 && e.status !== 429);
      const final = permanent || job.attempts >= job.maxAttempts;
      if (final) {
        await prisma.agentTask.update({ where: { id: taskId }, data: { status: "FAILED", error: msg.slice(0, 1000), finishedAt: new Date() } });
        await prisma.message.create({ data: { conversationId: task.conversation.id, role: "error", content: e instanceof AgentConfigError ? msg : `The agent hit an error and stopped: ${msg.slice(0, 300)}` } });
        return; // permanent failure: recorded, not retried
      }
      throw e;
    }
  },

  /** Seller agent reply to a buyer offer. Deterministic decision; optional LLM wording. */
  async "agent.seller_respond"(job, log) {
    const { negotiationId, offerId } = job.payload as { negotiationId: string; offerId: string };
    const n = await prisma.negotiation.findUnique({ where: { id: negotiationId }, include: { store: true } });
    const phrase = process.env.OPENAI_API_KEY && n ? (d: Parameters<typeof phraseSellerReply>[0]) => phraseSellerReply(d, n.store.name) : undefined;
    const r = await sellerAgentRespond(negotiationId, offerId, phrase);
    log(`seller agent on ${negotiationId}: ${r.action}`);
  },

  async "agent.execute_payment"(job, log) {
    const { orderId, agentId } = job.payload as { orderId: string; agentId: string };
    try {
      await executeAgentPayment(orderId, agentId, log);
    } catch (e) {
      if (e instanceof PaymentRefused) {
        // Refusals are final; record and stop retrying.
        await prisma.job.update({ where: { id: job.id }, data: { maxAttempts: job.attempts } });
      }
      throw e;
    }
  },
};
