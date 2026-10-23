"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { Bot, Check } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { MyStore } from "./page";

interface AgentRow { id: string; name: string; type: string; status: string; storeId: string | null; preferences: string; _count: { negotiations: number } }

export function SellerAgent({ store }: { store: MyStore }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: AgentRow[] }>("/agents") });
  const cfg = useQuery({ queryKey: ["agent-config"], queryFn: () => api<{ aiConfigured: boolean; aiModel: string | null }>("/agents/config") });
  const agent = q.data?.items.find((a) => a.type === "SELLER" && a.storeId === store.id && a.status !== "REVOKED");
  const [prefs, setPrefs] = useState<string | null>(null);
  const on = agent?.status === "ACTIVE";

  async function toggle(enabled: boolean) {
    try {
      await api(`/merchant/stores/${store.id}/agent`, { json: { enabled, preferences: prefs ?? agent?.preferences } });
      toast({ title: enabled ? "Sales agent active" : "Sales agent paused", tone: "ok" });
      void q.refetch();
    } catch (e: any) {
      toast({ title: "Could not update agent", body: e.message, tone: "error" });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1.2fr_1fr]">
      <section className="surface-raised rounded-3xl p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-evergreen text-champagne"><Bot size={18} /></div>
            <div>
              <p className="font-medium">{agent?.name ?? `${store.name} sales agent`}</p>
              <p className="text-[12.5px] text-mist">{on ? "Active · answering offers" : agent ? "Paused" : "Not enabled"}</p>
            </div>
          </div>
          <button className={`btn ${on ? "btn-secondary" : "btn-primary"} btn-sm`} onClick={() => toggle(!on)}>{on ? "Pause agent" : agent ? "Resume agent" : "Enable agent"}</button>
        </div>
        <div className="mt-6">
          <label className="label" htmlFor="prefs">Guidance for the agent's wording (tone, what to mention)</label>
          <textarea id="prefs" className="field" rows={3} value={prefs ?? agent?.preferences ?? ""} onChange={(e) => setPrefs(e.target.value)} placeholder="Friendly and brief. Mention that we ship within two days." />
          <p className="mt-1 text-[11.5px] text-dim">Guidance only changes how replies are worded. Prices are decided by your floor prices.</p>
        </div>
        {agent && <Link href={`/agents/${agent.id}`} className="btn btn-ghost btn-sm mt-4">View activity →</Link>}
      </section>
      <section className="space-y-3 text-[13.5px]">
        {[
          "Accepts any offer at or above list, or within 2% of it.",
          "Counters between the buyer's offer and list, never below your floor.",
          "Accepts at or above the floor in the final round; declines below it.",
          "Only acts on listings you marked negotiable.",
          "Every decision is logged and visible under Offers.",
        ].map((t) => <p key={t} className="flex gap-2"><Check size={14} className="mt-1 shrink-0 text-sage" />{t}</p>)}
        <p className="pt-2 text-[12.5px] text-dim">
          {cfg.data?.aiConfigured ? `Replies are worded by ${cfg.data.aiModel}.` : "AI wording is not configured on this server; the agent sends plain policy replies. Its decisions are the same either way."}
        </p>
      </section>
    </div>
  );
}
