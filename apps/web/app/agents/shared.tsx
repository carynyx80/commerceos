"use client";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";

export interface AgentRow {
  id: string;
  name: string;
  type: "BUYER" | "SELLER";
  status: "ACTIVE" | "PAUSED" | "REVOKED";
  description: string;
  preferences: string;
  accountAddress: string | null;
  store: { id: string; name: string; slug: string } | null;
  policy: {
    maxPerOrderCents: number;
    rollingLimitCents: number;
    rollingWindowDays: number;
    allowedAssets: ("USDG" | "ETH")[];
    approvedCategories: string[];
    approvedStoreIds: string[];
    expiresAt: string;
    maxDiscountAskBps: number;
    maxNegotiationRounds: number;
    automationEnabled: boolean;
    revokedAt: string | null;
  } | null;
  _count: { orders: number; negotiations: number; tasks: number };
}

export function StatusChip({ status }: { status: string }) {
  const c = status === "ACTIVE" ? "!text-ok !border-ok/40" : status === "PAUSED" ? "!text-warn !border-warn/40" : "!text-danger !border-danger/40";
  return <span className={`chip ${c}`}>{status.toLowerCase()}</span>;
}

export function PolicyFields({ v, set }: { v: PolicyForm; set: (p: Partial<PolicyForm>) => void }) {
  const stores = useQuery({ queryKey: ["stores-all"], queryFn: () => api<{ items: { id: string; name: string }[] }>("/stores/trending") });
  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api<{ name: string }[]>("/catalog/categories") });
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <L label="Max per order (USD)"><input className="field num" inputMode="decimal" value={v.maxPerOrder} onChange={(e) => set({ maxPerOrder: e.target.value })} /></L>
        <L label="Rolling limit (USD)"><input className="field num" inputMode="decimal" value={v.rolling} onChange={(e) => set({ rolling: e.target.value })} /></L>
        <L label="Window (days)"><input className="field num" inputMode="numeric" value={v.windowDays} onChange={(e) => set({ windowDays: e.target.value })} /></L>
        <L label="Authorization expires"><input type="date" className="field num" value={v.expires} onChange={(e) => set({ expires: e.target.value })} /></L>
        <L label="Max discount to ask (%)"><input className="field num" inputMode="numeric" value={v.discount} onChange={(e) => set({ discount: e.target.value })} /></L>
        <L label="Max negotiation rounds"><input className="field num" inputMode="numeric" value={v.rounds} onChange={(e) => set({ rounds: e.target.value })} /></L>
      </div>
      <L label="Allowed payment assets">
        <div className="flex gap-2">
          {(["USDG", "ETH"] as const).map((a) => (
            <button key={a} type="button" className={`chip num !h-8 !px-3 ${v.assets.includes(a) ? "!border-champagne/60 !text-champagne" : ""}`} onClick={() => set({ assets: v.assets.includes(a) ? v.assets.filter((x) => x !== a) : [...v.assets, a] })}>{a}</button>
          ))}
        </div>
      </L>
      <L label="Approved sellers (none selected = any seller)">
        <div className="flex flex-wrap gap-1.5">
          {stores.data?.items.map((s) => (
            <button key={s.id} type="button" className={`chip !h-7 ${v.stores.includes(s.id) ? "!border-champagne/60 !text-champagne" : ""}`} onClick={() => set({ stores: v.stores.includes(s.id) ? v.stores.filter((x) => x !== s.id) : [...v.stores, s.id] })}>{s.name}</button>
          ))}
        </div>
      </L>
      <L label="Approved categories (none selected = any)">
        <div className="flex flex-wrap gap-1.5">
          {cats.data?.map((c) => (
            <button key={c.name} type="button" className={`chip !h-7 ${v.categories.includes(c.name) ? "!border-champagne/60 !text-champagne" : ""}`} onClick={() => set({ categories: v.categories.includes(c.name) ? v.categories.filter((x) => x !== c.name) : [...v.categories, c.name] })}>{c.name}</button>
          ))}
        </div>
      </L>
    </div>
  );
}

export interface PolicyForm { maxPerOrder: string; rolling: string; windowDays: string; expires: string; discount: string; rounds: string; assets: ("USDG" | "ETH")[]; stores: string[]; categories: string[]; automation: boolean }

export const defaultPolicy = (): PolicyForm => ({
  maxPerOrder: "100",
  rolling: "300",
  windowDays: "30",
  expires: new Date(Date.now() + 7 * 86400_000).toISOString().slice(0, 10),
  discount: "15",
  rounds: "4",
  assets: ["USDG"],
  stores: [],
  categories: [],
  automation: false,
});

export function policyPayload(v: PolicyForm) {
  return {
    maxPerOrderCents: Math.round(Number(v.maxPerOrder) * 100),
    rollingLimitCents: Math.round(Number(v.rolling) * 100),
    rollingWindowDays: Number(v.windowDays),
    allowedAssets: v.assets,
    approvedCategories: v.categories,
    approvedStoreIds: v.stores,
    expiresAt: new Date(`${v.expires}T23:59:59`).toISOString(),
    maxDiscountAskBps: Math.round(Number(v.discount) * 100),
    maxNegotiationRounds: Number(v.rounds),
    automationEnabled: v.automation,
  };
}

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><p className="label">{label}</p>{children}</div>
);
