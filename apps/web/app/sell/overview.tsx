"use client";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { api } from "@/lib/api";
import type { MyStore } from "./page";

interface Analytics {
  grossSalesCents: number;
  settledSalesCents: number;
  netSettledCents: number;
  outstandingEscrowCents: number;
  completedOrders: number;
  paidOrders: number;
  checkoutsStarted: number;
  conversionRate: number | null;
  agentOrders: number;
  negotiatedOrders: number;
  feesCents: number;
  refunds: { count: number; cents: number };
  products: { id: string; title: string; units: number; revenueCents: number }[];
  daily: { date: string; grossCents: number; settledCents: number }[];
}

export function Overview({ store }: { store: MyStore }) {
  const q = useQuery({ queryKey: ["analytics", store.id], queryFn: () => api<Analytics>(`/merchant/stores/${store.id}/analytics`), refetchInterval: 10_000 });
  if (q.isLoading) return <p className="text-mist">Loading analytics…</p>;
  if (!q.data) return <p className="text-mist">Analytics are unavailable right now.</p>;
  const a = q.data;
  return (
    <div className="space-y-6">
      <p className="text-[12.5px] text-dim">Every figure is computed from orders confirmed by escrow events. Nothing is estimated.</p>
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-line lg:grid-cols-4">
        <Tile k="Gross sales" v={formatUsd(a.grossSalesCents)} sub={`${a.paidOrders} paid orders`} />
        <Tile k="Settled to you" v={formatUsd(a.netSettledCents)} sub={`${formatUsd(a.settledSalesCents)} gross · ${a.completedOrders} completed`} />
        <Tile k="Outstanding in escrow" v={formatUsd(a.outstandingEscrowCents)} sub="Paid, not yet released" />
        <Tile k="Checkout conversion" v={a.conversionRate === null ? "—" : `${(a.conversionRate * 100).toFixed(1)}%`} sub={`${a.checkoutsStarted} checkouts started`} />
        <Tile k="Marketplace fees" v={formatUsd(a.feesCents)} sub="2% of settled orders" />
        <Tile k="Refunds" v={formatUsd(a.refunds.cents)} sub={`${a.refunds.count} orders`} />
        <Tile k="Agent-placed orders" v={String(a.agentOrders)} sub="Bought by buyer agents" />
        <Tile k="Negotiated orders" v={String(a.negotiatedOrders)} sub="From accepted offers" />
      </div>

      <section className="surface rounded-2xl p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="font-medium">Gross sales, last 30 days</h2>
          <span className="num text-[12px] text-dim">USD per day</span>
        </div>
        <DailyBars data={a.daily} />
      </section>

      <section className="surface rounded-2xl p-5">
        <h2 className="mb-4 font-medium">Product performance</h2>
        {a.products.length === 0 ? (
          <p className="text-[13.5px] text-mist">No paid orders yet.</p>
        ) : (
          <table className="w-full text-[13.5px]">
            <thead className="text-left text-[12px] text-dim"><tr><th className="pb-2 font-normal">Product</th><th className="pb-2 text-right font-normal">Units</th><th className="pb-2 text-right font-normal">Revenue</th></tr></thead>
            <tbody>
              {a.products.map((p) => (
                <tr key={p.id} className="border-t hairline"><td className="py-2.5">{p.title}</td><td className="num py-2.5 text-right">{p.units}</td><td className="num py-2.5 text-right">{formatUsd(p.revenueCents)}</td></tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}

function Tile({ k, v, sub }: { k: string; v: string; sub: string }) {
  return (
    <div className="bg-obsidian-2 p-5">
      <p className="text-[12px] text-mist">{k}</p>
      <p className="num mt-2 text-[22px]">{v}</p>
      <p className="mt-1 text-[11.5px] text-dim">{sub}</p>
    </div>
  );
}

/** Single-series bar chart: thin bars, rounded data-ends, recessive grid, per-bar hover tooltip, table fallback. */
function DailyBars({ data }: { data: Analytics["daily"] }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.grossCents));
  const W = 720;
  const H = 180;
  const pad = { l: 44, r: 8, t: 8, b: 22 };
  const bw = (W - pad.l - pad.r) / data.length;
  const ticks = [0, 0.5, 1].map((t) => t * max);
  const y = (v: number) => pad.t + (H - pad.t - pad.b) * (1 - v / max);
  const empty = data.every((d) => d.grossCents === 0);
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Daily gross sales for the last 30 days">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="rgb(242 240 232 / 0.07)" />
            <text x={pad.l - 6} y={y(t) + 3} textAnchor="end" fontSize="10" fill="#6f7c77" fontFamily="var(--font-mono)">{t >= 100_000 ? `$${Math.round(t / 100_000)}k` : `$${Math.round(t / 100)}`}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const h = (H - pad.t - pad.b) * (d.grossCents / max);
          const x = pad.l + i * bw + 2;
          const w = Math.max(2, bw - 4);
          return (
            <g key={d.date} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
              <rect x={pad.l + i * bw} y={pad.t} width={bw} height={H - pad.t - pad.b} fill="transparent" />
              {h > 0 && <path d={`M${x},${H - pad.b} v${-Math.max(0, h - 4)} q0,-4 4,-4 h${w - 8} q4,0 4,4 v${Math.max(0, h - 4)} z`} fill={hover === i ? "#d8bf93" : "#c6a978"} />}
            </g>
          );
        })}
        <text x={pad.l} y={H - 6} fontSize="10" fill="#6f7c77" fontFamily="var(--font-mono)">{data[0]?.date.slice(5)}</text>
        <text x={W - pad.r} y={H - 6} fontSize="10" fill="#6f7c77" textAnchor="end" fontFamily="var(--font-mono)">{data.at(-1)?.date.slice(5)}</text>
      </svg>
      {hover !== null && (
        <div className="surface-raised pointer-events-none absolute top-0 rounded-lg px-3 py-2 text-[12px]" style={{ left: `${((pad.l + hover * bw) / W) * 100}%`, transform: "translateX(-50%)" }}>
          <p className="num text-mist">{data[hover].date}</p>
          <p className="num">{formatUsd(data[hover].grossCents)} gross</p>
          <p className="num text-mist">{formatUsd(data[hover].settledCents)} settled</p>
        </div>
      )}
      {empty && <p className="absolute inset-0 grid place-items-center text-[13px] text-dim">No sales in this period yet.</p>}
      <details className="mt-3 text-[12px] text-mist">
        <summary className="cursor-pointer">Show as table</summary>
        <table className="num mt-2 w-full">
          <tbody>{data.filter((d) => d.grossCents).map((d) => <tr key={d.date}><td>{d.date}</td><td className="text-right">{formatUsd(d.grossCents)}</td><td className="text-right">{formatUsd(d.settledCents)}</td></tr>)}</tbody>
        </table>
      </details>
    </div>
  );
}
