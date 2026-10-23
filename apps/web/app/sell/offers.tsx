"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { Bot } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { MyStore } from "./page";

interface Neg {
  id: string;
  status: string;
  quantity: number;
  asset: string;
  agreedCents: number | null;
  updatedAt: string;
  product: { title: string; priceCents: number; floorPriceCents: number | null };
  buyerAgent: { name: string } | null;
  sellerAgentId: string | null;
  offers: { id: string; from: "BUYER" | "SELLER"; priceCents: number; message: string; status: string; byAgent: boolean; createdAt: string }[];
}

export function Offers({ store }: { store: MyStore }) {
  const q = useQuery({ queryKey: ["store-negs", store.id], queryFn: () => api<{ items: Neg[] }>(`/merchant/negotiations?storeId=${store.id}`), refetchInterval: 5000 });
  if (!q.data?.items.length) return <div className="surface rounded-2xl p-10 text-center text-mist">{q.isLoading ? "Loading…" : "No offers yet. Enable negotiation on a product to receive offers."}</div>;
  return <ul className="space-y-3">{q.data.items.map((n) => <NegRow key={n.id} n={n} refetch={() => q.refetch()} />)}</ul>;
}

function NegRow({ n, refetch }: { n: Neg; refetch: () => void }) {
  const toast = useToast();
  const [counter, setCounter] = useState("");
  const last = n.offers.at(-1);
  const pendingFromBuyer = n.status === "OPEN" && last?.status === "PENDING" && last.from === "BUYER";
  const act = (path: string, json?: unknown) =>
    api(`/negotiations/${n.id}/${path}`, { json: json ?? {} }).then(() => { toast({ title: "Response sent", tone: "ok" }); refetch(); }).catch((e) => toast({ title: "Could not respond", body: e.message, tone: "error" }));
  return (
    <li className="surface rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-medium">{n.product.title}</p>
          <p className="text-[12px] text-mist">
            list {formatUsd(n.product.priceCents)} · floor {n.product.floorPriceCents != null ? formatUsd(n.product.floorPriceCents) : "—"} · qty {n.quantity} · {n.asset}
            {n.buyerAgent && <span className="ml-1 inline-flex items-center gap-1 text-champagne"><Bot size={11} /> buyer agent</span>}
          </p>
        </div>
        <span className={`chip ${n.status === "ACCEPTED" || n.status === "CONVERTED" ? "!text-ok" : n.status === "OPEN" ? "!text-champagne" : ""}`}>{n.status.toLowerCase()}{n.agreedCents ? ` · ${formatUsd(n.agreedCents)}` : ""}</span>
      </div>
      <ol className="mt-3 space-y-1.5 border-t hairline pt-3 text-[13px]">
        {n.offers.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-3">
            <span className={o.from === "SELLER" ? "text-sage" : ""}>
              {o.from === "SELLER" ? (o.byAgent ? "Your agent" : "You") : o.byAgent ? "Buyer's agent" : "Buyer"} · <span className="num">{formatUsd(o.priceCents)}</span>
              {o.message && <span className="text-mist"> — {o.message}</span>}
            </span>
            <span className="num shrink-0 text-[11px] text-dim">{o.status.toLowerCase()} · {timeAgo(o.createdAt)}</span>
          </li>
        ))}
      </ol>
      {pendingFromBuyer && (
        <div className="mt-3 flex flex-wrap items-center gap-2 border-t hairline pt-3">
          {n.sellerAgentId && <span className="text-[12px] text-dim">Your sales agent is answering this…</span>}
          <button className="btn btn-primary btn-sm" onClick={() => act("accept")}>Accept {formatUsd(last!.priceCents)}</button>
          <input className="field num !h-8 !w-28 text-[13px]" placeholder="Counter $" value={counter} onChange={(e) => setCounter(e.target.value.replace(/[^0-9.]/g, ""))} />
          <button className="btn btn-secondary btn-sm" disabled={!counter} onClick={() => act("offers", { priceCents: Math.round(Number(counter) * 100) })}>Counter</button>
          <button className="btn btn-ghost btn-sm" onClick={() => act("reject")}>Decline</button>
        </div>
      )}
    </li>
  );
}
