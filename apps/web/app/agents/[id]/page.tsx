"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import { erc20Abi, type Hex } from "viem";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { agentAccountAbi, agentAccountFactoryAbi, agentPolicyModuleAbi, explorerTx } from "@commerce-os/blockchain";
import { formatUnits, formatUsd } from "@commerce-os/shared";
import { Bot, Check, Lock } from "@/components/icons";
import { OrderStateChip } from "@/components/order-state";
import { SignInGate } from "@/components/sign-in-gate";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { shortAddr, timeAgo } from "@/lib/format";
import { CHAIN_ID } from "@/lib/wagmi";
import { PolicyFields, StatusChip, policyPayload, type AgentRow, type PolicyForm } from "../shared";

interface Detail extends AgentRow {
  tasks: { id: string; status: string; step: string | null; createdAt: string; toolExecutions: { tool: string; error: string | null; durationMs: number | null }[] }[];
  activity: { id: string; action: string; actorType: string; createdAt: string; data: any }[];
  negotiations: { id: string; status: string; agreedCents: number | null; product: { title: string }; offers: { from: string; priceCents: number; status: string }[] }[];
  orders: { id: string; state: any; totalCents: number; asset: string; product: { title: string }; payments: { txHash: string; status: string }[] }[];
  policyCheck: { spentInWindowCents: number; remainingCents: number; allowed: boolean; reasons: string[] } | null;
  onchain: any;
}

interface Cfg { autonomousPaymentsEnabled: boolean; executor: Hex | null; accountFactory: Hex | null; policyModule: Hex | null; usdg: Hex | null; aiConfigured: boolean }

export default function AgentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SignInGate title="Agent">
      <AgentView id={id} />
    </SignInGate>
  );
}

function AgentView({ id }: { id: string }) {
  const toast = useToast();
  const q = useQuery({ queryKey: ["agent", id], queryFn: () => api<Detail>(`/agents/${id}`), refetchInterval: 6000 });
  const cfg = useQuery({ queryKey: ["agent-config"], queryFn: () => api<Cfg>("/agents/config") });
  const [editing, setEditing] = useState(false);
  if (q.isLoading) return <p className="px-4 py-32 text-center text-mist">Loading…</p>;
  if (!q.data) return <p className="px-4 py-32 text-center text-mist">Agent not found.</p>;
  const a = q.data;

  const control = (action: "pause" | "resume" | "revoke") =>
    api<{ note?: string }>(`/agents/${id}/${action}`, { json: {} })
      .then((r) => { toast({ title: `Agent ${action === "revoke" ? "revoked" : action === "pause" ? "paused" : "resumed"}`, body: r.note, tone: "ok" }); void q.refetch(); })
      .catch((e) => toast({ title: "Failed", body: e.message, tone: "error" }));

  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <Link href="/agents" className="text-[13px] text-mist hover:text-porcelain">← Agent Studio</Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="flex items-center gap-4">
          <div className="grid size-14 place-items-center rounded-full bg-evergreen text-champagne"><Bot size={22} /></div>
          <div>
            <h1 className="display text-[clamp(34px,4vw,52px)]">{a.name}</h1>
            <p className="text-[13px] text-mist">{a.type === "BUYER" ? "Buyer agent" : `Seller agent · ${a.store?.name}`} {a.description && `· ${a.description}`}</p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={a.status} />
          {a.type === "BUYER" && a.status === "ACTIVE" && <Link href={`/workspace`} className="btn btn-primary btn-sm">Create task</Link>}
          {a.status === "ACTIVE" && <button className="btn btn-secondary btn-sm" onClick={() => control("pause")}>Pause agent</button>}
          {a.status === "PAUSED" && <button className="btn btn-secondary btn-sm" onClick={() => control("resume")}>Resume agent</button>}
          {a.type === "BUYER" && a.status !== "REVOKED" && <button className="btn btn-ghost btn-sm !text-danger" onClick={() => confirm("Revoke this agent's spending authorization?") && control("revoke")}>Revoke authorization</button>}
          {a.type === "BUYER" && <button className="btn btn-ghost btn-sm" onClick={() => setEditing((v) => !v)}>{editing ? "Close editor" : "Edit preferences"}</button>}
        </div>
      </div>

      {editing && a.policy && <EditPolicy a={a} onSaved={() => { setEditing(false); void q.refetch(); }} />}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.25fr_1fr]">
        <div className="space-y-6">
          {a.type === "BUYER" && a.policy && (
            <section className="surface-raised rounded-3xl p-6">
              <p className="eyebrow mb-5">Spending permissions</p>
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                <Stat k="Per order" v={formatUsd(a.policy.maxPerOrderCents)} />
                <Stat k={`${a.policy.rollingWindowDays}-day limit`} v={formatUsd(a.policy.rollingLimitCents)} />
                <Stat k="Spent in window" v={formatUsd(a.policyCheck?.spentInWindowCents ?? 0)} />
                <Stat k="Remaining" v={formatUsd(a.policyCheck?.remainingCents ?? 0)} />
              </div>
              <div className="mt-5 h-1.5 overflow-hidden rounded-full bg-porcelain/10">
                <div className="h-full bg-champagne" style={{ width: `${Math.min(100, ((a.policyCheck?.spentInWindowCents ?? 0) / a.policy.rollingLimitCents) * 100)}%` }} />
              </div>
              <dl className="mt-5 grid gap-2 text-[13px] sm:grid-cols-2">
                <Row k="Assets" v={a.policy.allowedAssets.join(" · ")} />
                <Row k="Expires" v={new Date(a.policy.expiresAt).toLocaleString()} />
                <Row k="Approved sellers" v={a.policy.approvedStoreIds.length ? `${a.policy.approvedStoreIds.length} selected` : "Any"} />
                <Row k="Approved categories" v={a.policy.approvedCategories.length ? a.policy.approvedCategories.join(", ") : "Any"} />
                <Row k="Max discount ask" v={`${a.policy.maxDiscountAskBps / 100}%`} />
                <Row k="Automation" v={a.policy.automationEnabled ? "Pays automatically within policy" : "Asks you to pay"} />
              </dl>
              {a.policy.revokedAt && <p className="mt-4 text-[13px] text-danger">Authorization revoked {timeAgo(a.policy.revokedAt)}.</p>}
            </section>
          )}

          {a.type === "BUYER" && cfg.data && <SmartAccount a={a} cfg={cfg.data} refetch={() => q.refetch()} />}

          <section className="surface rounded-2xl p-5">
            <p className="eyebrow mb-4">Negotiation history</p>
            {a.negotiations.length === 0 ? <p className="text-[13px] text-mist">None yet.</p> : (
              <ul className="space-y-2 text-[13px]">
                {a.negotiations.map((n) => (
                  <li key={n.id} className="flex items-center justify-between gap-3">
                    <Link href={`/workspace?negotiation=${n.id}`} className="truncate hover:text-champagne">{n.product.title}</Link>
                    <span className="num shrink-0 text-mist">{n.offers.map((o) => formatUsd(o.priceCents)).join(" → ")} · {n.status.toLowerCase()}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="surface rounded-2xl p-5">
            <p className="eyebrow mb-4">Purchases & transactions</p>
            {a.orders.length === 0 ? <p className="text-[13px] text-mist">No purchases yet.</p> : (
              <ul className="space-y-2 text-[13px]">
                {a.orders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between gap-3">
                    <Link href={`/orders/${o.id}`} className="truncate hover:text-champagne">{o.product.title}</Link>
                    <span className="flex shrink-0 items-center gap-2"><span className="num">{formatUsd(o.totalCents)}</span><OrderStateChip state={o.state} />
                      {o.payments[0] && (explorerTx(CHAIN_ID, o.payments[0].txHash) ? <a className="num text-[11px] text-sage" target="_blank" rel="noreferrer" href={explorerTx(CHAIN_ID, o.payments[0].txHash)!}>tx</a> : <span className="num text-[11px] text-dim" title={o.payments[0].txHash}>{shortAddr(o.payments[0].txHash)}</span>)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        <aside className="space-y-6">
          <section className="surface rounded-2xl p-5">
            <p className="eyebrow mb-4">Active & recent tasks</p>
            {a.tasks.length === 0 ? <p className="text-[13px] text-mist">No tasks yet.</p> : (
              <ul className="space-y-3 text-[12.5px]">
                {a.tasks.map((t) => (
                  <li key={t.id}>
                    <div className="flex justify-between"><span className={t.status === "FAILED" ? "text-danger" : t.status === "RUNNING" ? "text-champagne" : "text-porcelain"}>{t.status.toLowerCase()}{t.step ? ` · ${t.step}` : ""}</span><span className="text-dim">{timeAgo(t.createdAt)}</span></div>
                    {t.toolExecutions.length > 0 && <p className="num mt-0.5 text-[11px] text-dim">{t.toolExecutions.map((x) => x.tool).join(" → ")}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          <section className="surface rounded-2xl p-5">
            <p className="eyebrow mb-4">Activity log</p>
            <ul className="space-y-2 text-[12.5px]">
              {a.activity.length === 0 && <li className="text-mist">No activity yet.</li>}
              {a.activity.map((e) => (
                <li key={e.id} className="flex justify-between gap-3"><span className="num">{e.action}</span><span className="shrink-0 text-dim">{e.actorType} · {timeAgo(e.createdAt)}</span></li>
              ))}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}

function EditPolicy({ a, onSaved }: { a: Detail; onSaved: () => void }) {
  const toast = useToast();
  const p = a.policy!;
  const [prefs, setPrefs] = useState(a.preferences);
  const [v, setV] = useState<PolicyForm>({
    maxPerOrder: String(p.maxPerOrderCents / 100),
    rolling: String(p.rollingLimitCents / 100),
    windowDays: String(p.rollingWindowDays),
    expires: p.expiresAt.slice(0, 10),
    discount: String(p.maxDiscountAskBps / 100),
    rounds: String(p.maxNegotiationRounds),
    assets: p.allowedAssets,
    stores: p.approvedStoreIds,
    categories: p.approvedCategories,
    automation: p.automationEnabled,
  });
  return (
    <section className="surface mt-8 rounded-3xl p-6">
      <p className="eyebrow mb-4">Preferences & policy</p>
      <label className="label">Shopping preferences</label>
      <textarea className="field mb-5" rows={3} value={prefs} onChange={(e) => setPrefs(e.target.value)} />
      <PolicyFields v={v} set={(x) => setV((o) => ({ ...o, ...x }))} />
      <label className="mt-5 flex items-center gap-2 text-[13.5px]">
        <input type="checkbox" className="size-4 accent-[#C6A978]" checked={v.automation} disabled={!a.accountAddress} onChange={() => setV((o) => ({ ...o, automation: !o.automation }))} />
        Let this agent pay automatically within this policy {!a.accountAddress && <span className="text-dim">(deploy the smart account first)</span>}
      </label>
      <p className="mt-2 text-[12px] text-dim">Changing the policy here updates Commerce OS. If the agent has a smart account, also re-sync the on-chain policy below — the contract is what enforces it.</p>
      <button className="btn btn-primary mt-5" onClick={() => api(`/agents/${a.id}`, { method: "PATCH", json: { preferences: prefs, policy: policyPayload(v) } }).then(() => { toast({ title: "Policy saved", tone: "ok" }); onSaved(); }).catch((e) => toast({ title: "Not saved", body: e.message, tone: "error" }))}>Save</button>
    </section>
  );
}

/** Deploys and configures the user's AgentAccount from their own wallet. Commerce OS never holds the owner key. */
function SmartAccount({ a, cfg, refetch }: { a: Detail; cfg: Cfg; refetch: () => void }) {
  const toast = useToast();
  const { address } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const [busy, setBusy] = useState<string | null>(null);
  const [fund, setFund] = useState("50");
  const predicted = useReadContract({ address: cfg.accountFactory ?? undefined, abi: agentAccountFactoryAbi, functionName: "accountAddress", args: address ? [address, 0n] : undefined, query: { enabled: !!cfg.accountFactory && !!address } });
  const acct = (a.accountAddress ?? predicted.data) as Hex | undefined;
  const code = useQuery({ queryKey: ["code", acct], enabled: !!acct, queryFn: async () => ((await client!.getCode({ address: acct! })) ?? "0x").length > 2, refetchInterval: 5000 });
  const key = useReadContract({ address: acct, abi: agentAccountAbi, functionName: "agentKey", query: { enabled: !!acct && !!code.data, refetchInterval: 5000 } });
  const bal = useReadContract({ address: cfg.usdg ?? undefined, abi: erc20Abi, functionName: "balanceOf", args: acct ? [acct] : undefined, query: { enabled: !!acct && !!code.data && !!cfg.usdg, refetchInterval: 5000 } });

  if (!cfg.accountFactory || !cfg.executor) {
    return (
      <section className="surface rounded-2xl p-5">
        <p className="eyebrow mb-2">Smart account</p>
        <p className="text-[13px] text-mist">Autonomous payments are not available on this deployment (contracts or executor not configured). The agent prepares checkouts for you to pay.</p>
      </section>
    );
  }

  async function tx(label: string, fn: () => Promise<Hex>) {
    setBusy(label);
    try {
      const h = await fn();
      const r = await client!.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("reverted");
      toast({ title: `${label} confirmed`, tone: "ok" });
      await code.refetch();
      await key.refetch();
      await bal.refetch();
      refetch();
    } catch (e: any) {
      toast({ title: `${label} failed`, body: e?.shortMessage ?? e?.message, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const p = a.policy!;
  const deployed = !!code.data;
  const keySet = deployed && key.data?.toLowerCase() === cfg.executor.toLowerCase();
  const onchainOk = a.onchain && !a.onchain.error && Number(a.onchain.maxPerOrderUsd) === p.maxPerOrderCents * 10_000 && !a.onchain.revoked;
  const linked = !!a.accountAddress;

  async function syncPolicy() {
    const stores = await api<{ items: { id: string; payoutAddress: Hex }[] }>("/stores/trending");
    await tx("Policy sync", () =>
      writeContractAsync({
        address: cfg.policyModule!,
        abi: agentPolicyModuleAbi,
        functionName: "setPolicy",
        args: [acct!, {
          maxPerOrderUsd: BigInt(p.maxPerOrderCents) * 10_000n,
          rollingLimitUsd: BigInt(p.rollingLimitCents) * 10_000n,
          window: p.rollingWindowDays * 86400,
          expiresAt: Math.floor(new Date(p.expiresAt).getTime() / 1000),
          allowedAssets: (p.allowedAssets.includes("USDG") ? 1 : 0) | (p.allowedAssets.includes("ETH") ? 2 : 0),
          merchantAllowlist: p.approvedStoreIds.length > 0,
          revoked: false,
          nonce: 0n,
        }],
      }),
    );
    for (const sid of p.approvedStoreIds) {
      const s = stores.items.find((x) => x.id === sid);
      if (s) await tx(`Approve seller ${shortAddr(s.payoutAddress)}`, () => writeContractAsync({ address: cfg.policyModule!, abi: agentPolicyModuleAbi, functionName: "setMerchant", args: [acct!, s.payoutAddress, true] }));
    }
  }

  const steps: { label: string; done: boolean; action?: React.ReactNode }[] = [
    { label: "Deploy agent account", done: deployed, action: <button className="btn btn-secondary btn-sm" disabled={!!busy} onClick={() => tx("Deploy", () => writeContractAsync({ address: cfg.accountFactory!, abi: agentAccountFactoryAbi, functionName: "createAccount", args: [0n] }))}>Deploy</button> },
    { label: "Authorize the Commerce OS agent key (pay escrow quotes only)", done: keySet, action: <button className="btn btn-secondary btn-sm" disabled={!!busy || !deployed} onClick={() => tx("Agent key", () => writeContractAsync({ address: acct!, abi: agentAccountAbi, functionName: "setAgentKey", args: [cfg.executor!] }))}>Authorize</button> },
    { label: "Write spending policy on-chain", done: !!onchainOk, action: <button className="btn btn-secondary btn-sm" disabled={!!busy || !deployed} onClick={syncPolicy}>{a.onchain && !a.onchain.error ? "Re-sync" : "Write policy"}</button> },
    { label: "Link account to this agent", done: linked, action: <button className="btn btn-secondary btn-sm" disabled={!!busy || !keySet} onClick={() => api(`/agents/${a.id}/account`, { json: { accountAddress: acct } }).then(() => { toast({ title: "Account linked", tone: "ok" }); refetch(); }).catch((e) => toast({ title: "Link failed", body: e.message, tone: "error" }))}>Link</button> },
  ];

  return (
    <section className="surface rounded-3xl p-6">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Smart account · autonomous payments</p>
        {acct && <span className="num text-[12px] text-mist">{shortAddr(acct)}</span>}
      </div>
      <p className="mt-2 text-[12.5px] text-dim">Owned by your wallet. The agent key can only pay server-signed escrow quotes after the AgentPolicyModule contract checks every limit. Unaudited contracts — keep balances small.</p>
      <ol className="mt-5 space-y-3">
        {steps.map((s, i) => (
          <li key={s.label} className="flex items-center justify-between gap-3 text-[13.5px]">
            <span className={`flex items-center gap-2 ${s.done ? "text-sage" : ""}`}>
              <span className={`grid size-5 place-items-center rounded-full border text-[10px] num ${s.done ? "border-sage/50" : "hairline"}`}>{s.done ? <Check size={11} /> : i + 1}</span>
              {s.label}
            </span>
            {!s.done && s.action}
          </li>
        ))}
      </ol>
      {deployed && (
        <div className="mt-5 border-t hairline pt-5">
          <div className="flex flex-wrap items-center justify-between gap-3 text-[13px]">
            <span>Budget balance: <span className="num">{bal.data !== undefined ? formatUnits(bal.data, 6, 2) : "…"} USDG</span></span>
            <div className="flex items-center gap-2">
              <input className="field num !h-8 !w-24 text-[13px]" value={fund} onChange={(e) => setFund(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="USDG amount" />
              <button className="btn btn-secondary btn-sm" disabled={!!busy || !cfg.usdg} onClick={() => tx("Fund USDG", () => writeContractAsync({ address: cfg.usdg!, abi: erc20Abi, functionName: "transfer", args: [acct!, BigInt(Math.round(Number(fund) * 1e6))] }))}>Add USDG</button>
              <button className="btn btn-ghost btn-sm" disabled={!!busy || !(bal.data && bal.data > 0n)} onClick={() => tx("Withdraw", () => writeContractAsync({ address: acct!, abi: agentAccountAbi, functionName: "execute", args: [cfg.usdg!, 0n, encodeTransfer(address!, bal.data!)] }))}>Withdraw all</button>
            </div>
          </div>
          {a.onchain && !a.onchain.error && (
            <p className="num mt-3 text-[11.5px] text-dim">on-chain: max ${Number(a.onchain.maxPerOrderUsd) / 1e6}/order · ${Number(a.onchain.rollingLimitUsd) / 1e6}/{a.onchain.window / 86400}d · spent ${Number(a.onchain.spentInWindowUsd) / 1e6} · nonce {a.onchain.nonce}{a.onchain.revoked ? " · REVOKED" : ""}</p>
          )}
          {a.onchain && !a.onchain.error && !a.onchain.revoked && (
            <button className="btn btn-ghost btn-sm mt-3 !text-danger" disabled={!!busy} onClick={() => tx("On-chain revoke", () => writeContractAsync({ address: cfg.policyModule!, abi: agentPolicyModuleAbi, functionName: "revoke", args: [acct!] }))}><Lock size={13} /> Revoke on-chain</button>
          )}
          {!cfg.autonomousPaymentsEnabled && <p className="mt-3 text-[12px] text-warn">Autonomous execution is switched off on this server; the agent will still ask you to pay.</p>}
        </div>
      )}
    </section>
  );
}

function encodeTransfer(to: Hex, amount: bigint): Hex {
  // transfer(address,uint256)
  return `0xa9059cbb${to.slice(2).toLowerCase().padStart(64, "0")}${amount.toString(16).padStart(64, "0")}` as Hex;
}

const Stat = ({ k, v }: { k: string; v: string }) => (<div><p className="text-[11.5px] text-dim">{k}</p><p className="num mt-1 text-[18px]">{v}</p></div>);
const Row = ({ k, v }: { k: string; v: string }) => (<div className="flex justify-between gap-3 border-b hairline py-1.5"><dt className="text-mist">{k}</dt><dd className="text-right">{v}</dd></div>);
