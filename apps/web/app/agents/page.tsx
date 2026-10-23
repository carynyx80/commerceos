"use client";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { Bot, Close, Plus } from "@/components/icons";
import { SignInGate } from "@/components/sign-in-gate";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { PolicyFields, StatusChip, defaultPolicy, policyPayload, type AgentRow, type PolicyForm } from "./shared";

export default function AgentsPage() {
  return (
    <SignInGate title="Agent Studio">
      <Suspense>
        <Studio />
      </Suspense>
    </SignInGate>
  );
}

function Studio() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: AgentRow[] }>("/agents") });
  const creating = sp.get("new") === "1";
  return (
    <div className="mx-auto max-w-[1300px] px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Agent Studio</p>
          <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Your agents</h1>
          <p className="mt-2 max-w-xl text-mist">Agents act within limits you set. Buyer agents shop and negotiate; with a smart account they can also pay, and the policy contract enforces every limit.</p>
        </div>
        <button className="btn btn-primary" onClick={() => router.push("/agents?new=1")}><Plus size={15} /> Create agent</button>
      </div>

      {q.isLoading ? (
        <p className="mt-10 text-mist">Loading…</p>
      ) : !q.data?.items.length ? (
        <div className="surface mt-10 rounded-3xl p-12 text-center">
          <Bot size={24} className="mx-auto text-champagne" />
          <p className="display mt-5 text-[30px]">No agents yet.</p>
          <p className="mt-2 text-mist">Create a buyer agent with a spending policy to delegate shopping.</p>
        </div>
      ) : (
        <div className="mt-10 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.items.map((a, i) => (
            <motion.div key={a.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.04 }}>
              <Link href={`/agents/${a.id}`} className="surface block rounded-3xl p-6 transition-colors hover:border-line-2">
                <div className="flex items-start justify-between">
                  <div className="grid size-11 place-items-center rounded-full bg-evergreen text-champagne"><Bot size={18} /></div>
                  <StatusChip status={a.status} />
                </div>
                <p className="mt-5 text-[17px] font-medium">{a.name}</p>
                <p className="text-[12.5px] text-mist">{a.type === "BUYER" ? "Buyer agent" : `Seller agent · ${a.store?.name ?? ""}`}</p>
                {a.policy && (
                  <dl className="mt-5 grid grid-cols-2 gap-3 border-t hairline pt-4 text-[12px]">
                    <div><dt className="text-dim">Per order</dt><dd className="num">{formatUsd(a.policy.maxPerOrderCents)}</dd></div>
                    <div><dt className="text-dim">{a.policy.rollingWindowDays}-day limit</dt><dd className="num">{formatUsd(a.policy.rollingLimitCents)}</dd></div>
                    <div><dt className="text-dim">Automation</dt><dd>{a.policy.automationEnabled ? "on" : "off"}</dd></div>
                    <div><dt className="text-dim">Expires</dt><dd className="num">{new Date(a.policy.expiresAt).toLocaleDateString()}</dd></div>
                  </dl>
                )}
                <p className="mt-4 text-[11.5px] text-dim"><span className="num">{a._count.tasks}</span> tasks · <span className="num">{a._count.negotiations}</span> negotiations · <span className="num">{a._count.orders}</span> orders</p>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      <AnimatePresence>{creating && <CreateAgent onClose={() => { router.push("/agents"); void q.refetch(); }} />}</AnimatePresence>
    </div>
  );
}

function CreateAgent({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [preferences, setPreferences] = useState("");
  const [p, setP] = useState<PolicyForm>(defaultPolicy());
  const [busy, setBusy] = useState(false);
  return (
    <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l hairline bg-obsidian-2">
        <div className="flex h-16 items-center justify-between border-b hairline px-6">
          <h2 className="display text-[26px]">New buyer agent</h2>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close"><Close size={17} /></button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <L label="Name"><input className="field" value={name} onChange={(e) => setName(e.target.value)} placeholder="Camera scout" /></L>
          <L label="Description"><input className="field" value={description} onChange={(e) => setDescription(e.target.value)} /></L>
          <L label="Shopping preferences"><textarea className="field" rows={3} value={preferences} onChange={(e) => setPreferences(e.target.value)} placeholder="Prefer verified sellers and refurbished grade A. Avoid digital goods." /></L>
          <div className="rounded-2xl border hairline p-4">
            <p className="eyebrow mb-4">Spending policy</p>
            <PolicyFields v={p} set={(x) => setP((o) => ({ ...o, ...x }))} />
            <p className="mt-4 text-[12px] text-dim">Automation (paying without asking) can be turned on after you deploy the agent's smart account. Until then the agent prepares checkouts for you to pay.</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t hairline p-4">
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn btn-primary"
            disabled={busy || name.trim().length < 2}
            onClick={async () => {
              setBusy(true);
              try {
                const a = await api<{ id: string }>("/agents", { json: { name, type: "BUYER", description, preferences, policy: policyPayload(p) } });
                toast({ title: "Agent created", tone: "ok" });
                router.push(`/agents/${a.id}`);
              } catch (e: any) {
                toast({ title: "Could not create agent", body: e.details ? JSON.stringify(e.details.fieldErrors ?? e.details) : e.message, tone: "error" });
              } finally {
                setBusy(false);
              }
            }}
          >
            Create agent
          </button>
        </div>
      </motion.aside>
    </motion.div>
  );
}


const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><p className="label">{label}</p>{children}</div>
);
