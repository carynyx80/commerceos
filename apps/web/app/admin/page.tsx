"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import Link from "next/link";
import { useState } from "react";
import { usePublicClient, useWriteContract } from "wagmi";
import { commerceEscrowAbi } from "@commerce-os/blockchain";
import { ORDER_STATE_LABEL, formatUsd, type OrderState } from "@commerce-os/shared";
import { OrderStateChip } from "@/components/order-state";
import { SignInGate } from "@/components/sign-in-gate";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { shortAddr, timeAgo } from "@/lib/format";

const TABS = ["overview", "users", "merchants", "products", "orders", "disputes", "agents", "security"] as const;
type Tab = (typeof TABS)[number];

export default function AdminPage() {
  return (
    <SignInGate title="Admin console" admin>
      <Admin />
    </SignInGate>
  );
}

function Admin() {
  const [tab, setTab] = useState<Tab>("overview");
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <p className="eyebrow">Operations</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Admin console</h1>
      <p className="mt-2 max-w-2xl text-[13.5px] text-mist">Every action here is audited. Nothing here can move escrowed funds: escrow administration is on-chain and owned by the multisig.</p>
      <nav className="mt-8 flex gap-1 overflow-x-auto border-b hairline">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)} className={`relative shrink-0 px-4 py-3 text-[13.5px] capitalize ${tab === t ? "text-porcelain" : "text-mist hover:text-porcelain"}`}>
            {t}
            {tab === t && <motion.span layoutId="admin-tab" className="absolute inset-x-2 -bottom-px h-px bg-champagne" />}
          </button>
        ))}
      </nav>
      <div className="mt-8">
        {tab === "overview" && <Overview />}
        {tab === "users" && <Users />}
        {tab === "merchants" && <Merchants />}
        {tab === "products" && <Products />}
        {tab === "orders" && <Orders />}
        {tab === "disputes" && <Disputes />}
        {tab === "agents" && <Agents />}
        {tab === "security" && <Security />}
      </div>
    </div>
  );
}

function useReason() {
  return () => {
    const r = window.prompt("Reason (recorded in the audit log):");
    return r && r.trim().length >= 3 ? r.trim() : null;
  };
}

function Overview() {
  const q = useQuery({ queryKey: ["admin-overview"], queryFn: () => api<any>("/admin/overview"), refetchInterval: 10_000 });
  const toast = useToast();
  const reason = useReason();
  const { writeContractAsync } = useWriteContract();
  const client = usePublicClient();
  if (!q.data) return <p className="text-mist">Loading…</p>;
  const o = q.data;
  const c = o.chain ?? {};
  const setFlag = async (key: string, value: boolean) => {
    const r = reason();
    if (!r) return;
    await api("/admin/flags", { json: { key, value, reason: r } }).then(() => q.refetch()).catch((e) => toast({ title: "Failed", body: e.message, tone: "error" }));
  };
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border hairline bg-line lg:grid-cols-4">
        <Tile k="Users" v={o.users} />
        <Tile k="Merchants" v={`${o.merchants} (${o.unverifiedMerchants} unverified)`} />
        <Tile k="Active products" v={o.activeProducts} />
        <Tile k="Open disputes" v={o.openDisputes} />
        <Tile k="Settled volume" v={formatUsd(o.ordersByState.RELEASED?.cents ?? 0)} />
        <Tile k="Fees earned (2%)" v={formatUsd(o.feesEarnedCents)} />
        <Tile k="Active agents" v={o.agentsByStatus.ACTIVE ?? 0} />
        <Tile k="Failed jobs" v={o.failedJobs} />
      </div>
      <section className="grid gap-6 lg:grid-cols-2">
        <div className="surface rounded-2xl p-5 text-[13.5px]">
          <p className="eyebrow mb-4">Escrow on-chain</p>
          {c.error ? <p className="text-danger">{c.error}</p> : (
            <dl className="space-y-1.5">
              <Row k="Chain" v={`${c.chainId}${c.testToken ? " · test USDG" : ""}`} />
              <Row k="Escrow" v={c.escrowExplorer ? <a href={c.escrowExplorer} className="text-sage" target="_blank" rel="noreferrer">{shortAddr(c.escrow)}</a> : shortAddr(c.escrow)} />
              <Row k="Status" v={c.paused ? <span className="text-danger">PAUSED</span> : <span className="text-ok">running</span>} />
              <Row k="Held in escrow" v={`${c.escrowedUsdg} USDG · ${c.escrowedEth} ETH`} />
              <Row k="Treasury" v={`${c.treasuryUsdg} USDG · ${c.treasuryEth} ETH`} />
              <Row k="Owner" v={shortAddr(c.owner)} />
              <Row k="Quote signer" v={shortAddr(c.quoteSigner)} />
            </dl>
          )}
          {!c.error && (
            <button
              className="btn btn-secondary btn-sm mt-4"
              onClick={async () => {
                try {
                  const h = await writeContractAsync({ address: c.escrow, abi: commerceEscrowAbi, functionName: c.paused ? "unpause" : "pause" });
                  await client!.waitForTransactionReceipt({ hash: h });
                  void q.refetch();
                } catch (e: any) {
                  toast({ title: "Escrow pause needs the pauser or owner wallet", body: e?.shortMessage ?? e?.message, tone: "error" });
                }
              }}
            >
              {c.paused ? "Unpause escrow (owner)" : "Emergency pause escrow"}
            </button>
          )}
          <p className="mt-2 text-[11.5px] text-dim">Sent from your connected wallet; only the pauser or owner (multisig) can do this. Refunds and disputes stay open while paused.</p>
        </div>
        <div className="surface rounded-2xl p-5 text-[13.5px]">
          <p className="eyebrow mb-4">Platform kill switches</p>
          {[["checkout.paused", "New checkouts"], ["agents.paused", "Agent execution"]].map(([k, label]) => {
            const on = o.flags[k]?.value;
            return (
              <div key={k} className="flex items-center justify-between border-b hairline py-3">
                <div><p>{label}</p><p className="text-[11.5px] text-dim">{on ? `Paused · ${o.flags[k].reason}` : "Running"}</p></div>
                <button className={`btn btn-sm ${on ? "btn-primary" : "btn-secondary"}`} onClick={() => setFlag(k, !on)}>{on ? "Resume" : "Pause"}</button>
              </div>
            );
          })}
          <p className="eyebrow mb-3 mt-6">Orders by state</p>
          <div className="flex flex-wrap gap-2">
            {Object.entries(o.ordersByState).map(([s, v]: any) => <span key={s} className="chip">{ORDER_STATE_LABEL[s as OrderState]} · <span className="num">{v.count}</span></span>)}
          </div>
        </div>
      </section>
    </div>
  );
}

function Users() {
  const [q, setQ] = useState("");
  const r = useQuery({ queryKey: ["admin-users", q], queryFn: () => api<{ items: any[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ""}`) });
  const toast = useToast();
  const reason = useReason();
  return (
    <div>
      <input className="field mb-4 max-w-sm" placeholder="Search by wallet or name" value={q} onChange={(e) => setQ(e.target.value)} />
      <Table head={["Wallet", "Role", "Merchant", "Orders", "Agents", "Joined", ""]}>
        {r.data?.items.map((u) => (
          <tr key={u.id} className="border-t hairline">
            <td className="num py-2.5">{shortAddr(u.wallets[0]?.address)}</td>
            <td>{u.role.toLowerCase()}</td>
            <td>{u.merchant ? (u.merchant.verified ? "verified" : "unverified") : "—"}</td>
            <td className="num">{u._count.ordersBought}</td>
            <td className="num">{u._count.agents}</td>
            <td className="text-dim">{timeAgo(u.createdAt)}</td>
            <td className="text-right">
              <button className="btn btn-ghost btn-sm" onClick={() => { const rs = reason(); if (rs) api(`/admin/users/${u.id}/suspend`, { json: { suspended: !u.suspended, reason: rs } }).then(() => r.refetch()).catch((e) => toast({ title: "Failed", body: e.message, tone: "error" })); }}>{u.suspended ? "Unsuspend" : "Suspend"}</button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Merchants() {
  const r = useQuery({ queryKey: ["admin-merchants"], queryFn: () => api<{ items: any[] }>("/admin/merchants") });
  const toast = useToast();
  const reason = useReason();
  return (
    <Table head={["Merchant", "Stores", "Products", "Orders", "Status", ""]}>
      {r.data?.items.map((m) => (
        <tr key={m.id} className="border-t hairline">
          <td className="py-2.5"><span className="num">{shortAddr(m.user.wallets[0]?.address)}</span>{m.user.displayName && <span className="ml-2 text-mist">{m.user.displayName}</span>}</td>
          <td>{m.stores.map((s: any) => <Link key={s.id} href={`/store/${s.slug}`} className="mr-2 text-sage hover:underline">{s.name}{!s.active && " (inactive)"}</Link>)}</td>
          <td className="num">{m.stores.reduce((n: number, s: any) => n + s._count.products, 0)}</td>
          <td className="num">{m.stores.reduce((n: number, s: any) => n + s._count.orders, 0)}</td>
          <td>{m.verified ? <span className="text-ok">verified</span> : <span className="text-warn">unverified</span>}</td>
          <td className="text-right">
            <button className="btn btn-ghost btn-sm" onClick={() => { const n = reason(); if (n) api(`/admin/merchants/${m.id}/verify`, { json: { verified: !m.verified, note: n } }).then(() => r.refetch()).catch((e) => toast({ title: "Failed", body: e.message, tone: "error" })); }}>{m.verified ? "Unverify" : "Verify"}</button>
          </td>
        </tr>
      ))}
    </Table>
  );
}

function Products() {
  const [status, setStatus] = useState("");
  const r = useQuery({ queryKey: ["admin-products", status], queryFn: () => api<{ items: any[] }>(`/admin/products${status ? `?status=${status}` : ""}`) });
  const toast = useToast();
  const reason = useReason();
  return (
    <div>
      <select className="field mb-4 !w-auto" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option><option value="ACTIVE">Active</option><option value="REMOVED">Removed</option><option value="ARCHIVED">Archived</option></select>
      <Table head={["Product", "Store", "Price", "Status", ""]}>
        {r.data?.items.map((p) => (
          <tr key={p.id} className="border-t hairline">
            <td className="py-2.5"><Link href={`/product/${p.id}`} className="hover:text-champagne">{p.title}</Link>{p.isFixture && <span className="ml-2 text-[11px] text-dim">fixture</span>}</td>
            <td className="text-mist">{p.store.name}</td>
            <td className="num">{formatUsd(p.priceCents)}</td>
            <td>{p.status.toLowerCase()}</td>
            <td className="text-right">
              <button className="btn btn-ghost btn-sm" onClick={() => { const rs = reason(); if (rs) api(`/admin/products/${p.id}/moderate`, { json: { action: p.status === "REMOVED" ? "restore" : "remove", reason: rs } }).then(() => r.refetch()).catch((e) => toast({ title: "Failed", body: e.message, tone: "error" })); }}>{p.status === "REMOVED" ? "Restore" : "Remove"}</button>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Orders() {
  const [state, setState] = useState("");
  const r = useQuery({ queryKey: ["admin-orders", state], queryFn: () => api<{ items: any[] }>(`/admin/orders${state ? `?state=${state}` : ""}`), refetchInterval: 10_000 });
  return (
    <div>
      <select className="field mb-4 !w-auto" value={state} onChange={(e) => setState(e.target.value)}>
        <option value="">All states</option>
        {Object.entries(ORDER_STATE_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
      </select>
      <Table head={["Order", "Product", "Store", "Total", "State", "Payment"]}>
        {r.data?.items.map((o) => (
          <tr key={o.id} className="border-t hairline">
            <td className="py-2.5"><Link href={`/orders/${o.id}`} className="num text-sage hover:underline">{o.id.slice(-8)}</Link>{o.agentId && <span className="ml-1 text-[11px] text-champagne">agent</span>}</td>
            <td>{o.product.title}</td>
            <td className="text-mist">{o.store.name}</td>
            <td className="num">{formatUsd(o.totalCents)} <span className="text-dim">{o.asset}</span></td>
            <td><OrderStateChip state={o.state} /></td>
            <td className="num text-[12px]">{o.payments[0] ? (o.explorer ? <a href={o.explorer} target="_blank" rel="noreferrer" className="text-sage">{shortAddr(o.payments[0].txHash)}</a> : shortAddr(o.payments[0].txHash)) : "—"}</td>
          </tr>
        ))}
      </Table>
    </div>
  );
}

function Disputes() {
  const r = useQuery({ queryKey: ["admin-disputes"], queryFn: () => api<{ items: any[] }>("/admin/disputes") });
  if (!r.data?.items.length) return <p className="text-mist">No disputes.</p>;
  return (
    <div className="space-y-4">
      <p className="text-[12.5px] text-dim">Rulings are made on-chain in DisputeResolver by an ARBITER wallet (buyer share in basis points), finalized after the appeal window, or decided on appeal by the APPEALS multisig.</p>
      {r.data.items.map((d) => (
        <section key={d.id} className="surface rounded-2xl p-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <Link href={`/orders/${d.orderId}`} className="font-medium hover:text-champagne">{d.order.product.title}</Link>
              <p className="text-[12px] text-mist">{d.order.store.name} · {formatUsd(d.order.totalCents)} · opened by {d.openedBy.toLowerCase()} {timeAgo(d.createdAt)} · evidence until {new Date(d.evidenceDeadline).toLocaleDateString()}</p>
            </div>
            <span className="chip">{d.status.toLowerCase()}</span>
          </div>
          <ol className="mt-3 space-y-2 border-t hairline pt-3 text-[13px]">
            {d.evidence.map((e: any) => <li key={e.id}><span className="text-sage">{e.party.toLowerCase()}</span> · {e.content} <span className="num text-[11px] text-dim">{e.hash.slice(0, 10)}…</span></li>)}
          </ol>
          <p className="num mt-3 text-[11.5px] text-dim">escrow order {d.order.onchainId}</p>
        </section>
      ))}
    </div>
  );
}

function Agents() {
  const r = useQuery({ queryKey: ["admin-agents"], queryFn: () => api<any>("/admin/agents"), refetchInterval: 10_000 });
  if (!r.data) return <p className="text-mist">Loading…</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <section className="surface rounded-2xl p-5">
        <p className="eyebrow mb-4">Recent agent tasks</p>
        <ul className="space-y-2 text-[13px]">
          {r.data.tasks.map((t: any) => (
            <li key={t.id} className="flex justify-between gap-3"><span>{t.agent?.name ?? "No agent"} · <span className={t.status === "FAILED" ? "text-danger" : ""}>{t.status.toLowerCase()}</span>{t.error && <span className="text-dim"> — {t.error.slice(0, 80)}</span>}</span><span className="num shrink-0 text-dim">{t._count.toolExecutions} tools · {timeAgo(t.createdAt)}</span></li>
          ))}
        </ul>
      </section>
      <section className="surface rounded-2xl p-5">
        <p className="eyebrow mb-4">Agent payments</p>
        <ul className="space-y-2 text-[13px]">
          {r.data.payments.map((e: any) => <li key={e.id} className="flex justify-between gap-3"><span className="num">{e.action}</span><span className="text-dim">{JSON.stringify(e.data)?.slice(0, 60)} · {timeAgo(e.createdAt)}</span></li>)}
          {r.data.payments.length === 0 && <li className="text-mist">None yet.</li>}
        </ul>
        <p className="eyebrow mb-3 mt-6">Failed tool calls</p>
        <ul className="space-y-1 text-[12.5px]">{r.data.failedTools.map((t: any) => <li key={t.id}><span className="num">{t.tool}</span> · <span className="text-dim">{t.error}</span></li>)}</ul>
      </section>
    </div>
  );
}

function Security() {
  const r = useQuery({ queryKey: ["admin-security"], queryFn: () => api<any>("/admin/security"), refetchInterval: 15_000 });
  const toast = useToast();
  if (!r.data) return <p className="text-mist">Loading…</p>;
  return (
    <div className="grid gap-6 lg:grid-cols-[1.4fr_1fr]">
      <section className="surface rounded-2xl p-5">
        <p className="eyebrow mb-4">Security & admin events</p>
        <ul className="space-y-2 text-[12.5px]">
          {r.data.events.map((e: any) => <li key={e.id} className="flex justify-between gap-3"><span className={`num ${e.action.startsWith("security.") ? "text-danger" : ""}`}>{e.action}</span><span className="shrink-0 text-dim">{e.target?.slice(-8)} · {timeAgo(e.createdAt)}</span></li>)}
          {r.data.events.length === 0 && <li className="text-mist">No events.</li>}
        </ul>
      </section>
      <section className="surface rounded-2xl p-5">
        <p className="eyebrow mb-4">Failed jobs</p>
        <ul className="space-y-3 text-[12.5px]">
          {r.data.failedJobs.map((j: any) => (
            <li key={j.id}>
              <div className="flex justify-between"><span className="num">{j.kind}</span>{j.kind !== "agent.execute_payment" && <button className="text-sage hover:underline" onClick={() => api(`/admin/jobs/${j.id}/retry`, { json: {} }).then(() => r.refetch()).catch((e) => toast({ title: "Failed", body: e.message, tone: "error" }))}>retry</button>}</div>
              <p className="text-dim">{j.lastError?.slice(0, 140)}</p>
            </li>
          ))}
          {r.data.failedJobs.length === 0 && <li className="text-mist">None.</li>}
        </ul>
      </section>
    </div>
  );
}

function Tile({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="bg-obsidian-2 p-5"><p className="text-[12px] text-mist">{k}</p><p className="num mt-2 text-[20px]">{v}</p></div>;
}
function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex justify-between gap-4"><dt className="text-mist">{k}</dt><dd className="num text-right">{v}</dd></div>;
}
function Table({ head, children }: { head: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[720px] text-[13px]">
        <thead className="text-left text-[11.5px] text-dim"><tr>{head.map((h) => <th key={h} className="pb-2 font-normal">{h}</th>)}</tr></thead>
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}
