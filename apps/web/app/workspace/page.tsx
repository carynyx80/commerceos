"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Bot, Plus, Send, Spark } from "@/components/icons";
import { SignInGate } from "@/components/sign-in-gate";
import { useToast } from "@/components/toast";
import { api, ApiError } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import { IntelligencePanel, type Intel } from "./intelligence";
import { NegotiationPanel } from "./negotiation-panel";

interface Msg { id: string; role: "user" | "assistant" | "event" | "error"; content: string; data: Intel | null; createdAt: string }
interface Conv { id: string; title: string; updatedAt: string; agent: { id: string; name: string } | null }
interface Task { id: string; status: string; step: string | null }

const EXAMPLES = [
  "Find me a laptop under $1,200 from a verified seller.",
  "Compare over-ear headphones and tell me which has the best seller record.",
  "Negotiate the field watch down to around $440.",
  "What's the status of my orders?",
];

export default function WorkspacePage() {
  return (
    <SignInGate title="AI Commerce workspace">
      <Suspense>
        <Workspace />
      </Suspense>
    </SignInGate>
  );
}

function Workspace() {
  const sp = useSearchParams();
  const router = useRouter();
  const qc = useQueryClient();
  const toast = useToast();
  const convId = sp.get("c");
  const negotiateProduct = sp.get("negotiate");
  const negotiationId = sp.get("negotiation");
  const [mobileTab, setMobileTab] = useState<"tasks" | "chat" | "intel">("chat");
  const [draft, setDraft] = useState("");
  const [agentId, setAgentId] = useState<string>("");

  const cfg = useQuery({ queryKey: ["agent-config"], queryFn: () => api<{ aiConfigured: boolean; aiModel: string | null; autonomousPaymentsEnabled: boolean }>("/agents/config") });
  const convs = useQuery({ queryKey: ["conversations"], queryFn: () => api<{ items: Conv[] }>("/conversations") });
  const agents = useQuery({ queryKey: ["agents"], queryFn: () => api<{ items: { id: string; name: string; type: string; status: string }[] }>("/agents") });
  const negs = useQuery({ queryKey: ["my-negotiations"], queryFn: () => api<{ items: { id: string; status: string; product: { title: string } }[] }>("/negotiations"), refetchInterval: 8000 });
  const buyerAgents = agents.data?.items.filter((a) => a.type === "BUYER" && a.status === "ACTIVE") ?? [];

  const conv = useQuery({
    queryKey: ["conversation", convId],
    enabled: !!convId,
    queryFn: () => api<{ conversation: Conv & { agent: { name: string } | null }; messages: Msg[]; task: Task | null }>(`/conversations/${convId}`),
    refetchInterval: (q) => (q.state.data?.task && ["QUEUED", "RUNNING"].includes(q.state.data.task.status) ? 1000 : false),
  });
  const working = !!conv.data?.task && ["QUEUED", "RUNNING"].includes(conv.data.task.status);
  const msgs = conv.data?.messages ?? [];
  const latestIntel = useMemo(() => [...msgs].reverse().find((m) => m.role === "assistant" && m.data)?.data ?? null, [msgs]);

  const bottom = useRef<HTMLDivElement>(null);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" }), [msgs.length, working]);

  async function send(text: string) {
    const content = text.trim();
    if (!content) return;
    try {
      let id = convId;
      if (!id) {
        const c = await api<{ id: string }>("/conversations", { json: { agentId: agentId || null } });
        id = c.id;
        router.replace(`/workspace?c=${id}`);
      }
      setDraft("");
      await api(`/conversations/${id}/messages`, { json: { content } });
      await qc.invalidateQueries({ queryKey: ["conversation", id] });
      await qc.invalidateQueries({ queryKey: ["conversations"] });
    } catch (e) {
      const err = e as ApiError;
      toast({ title: err.code === "AI_NOT_CONFIGURED" ? "AI is not configured" : "Message not sent", body: err.message, tone: "error" });
    }
  }

  const left = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto p-4 text-[13.5px]">
      <button className="btn btn-primary w-full" onClick={() => router.push("/workspace")}><Plus size={14} /> New shopping task</button>
      <Group title="Agents" action={<Link href="/agents" className="text-[11.5px] text-sage hover:underline">Studio</Link>}>
        {buyerAgents.length === 0 && <p className="px-2 text-[12.5px] text-dim">No buyer agents. <Link href="/agents?new=1" className="text-champagne">Create one</Link> to delegate purchases.</p>}
        {buyerAgents.map((a) => <Link key={a.id} href={`/agents/${a.id}`} className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-mist hover:bg-white/5 hover:text-porcelain"><Bot size={13} className="text-champagne" />{a.name}</Link>)}
      </Group>
      <Group title="Recent conversations">
        {convs.data?.items.length === 0 && <p className="px-2 text-[12.5px] text-dim">None yet.</p>}
        {convs.data?.items.slice(0, 12).map((c) => (
          <Link key={c.id} href={`/workspace?c=${c.id}`} className={`block truncate rounded-lg px-2 py-1.5 ${c.id === convId ? "bg-evergreen/60 text-porcelain" : "text-mist hover:bg-white/5 hover:text-porcelain"}`}>{c.title}</Link>
        ))}
      </Group>
      <Group title="Active negotiations">
        {negs.data?.items.filter((n) => ["OPEN", "ACCEPTED"].includes(n.status)).slice(0, 8).map((n) => (
          <Link key={n.id} href={`/workspace?negotiation=${n.id}`} className="flex justify-between gap-2 rounded-lg px-2 py-1.5 text-mist hover:bg-white/5 hover:text-porcelain"><span className="truncate">{n.product.title}</span><span className="text-[11px] text-dim">{n.status.toLowerCase()}</span></Link>
        )) ?? null}
        {!negs.data?.items.some((n) => ["OPEN", "ACCEPTED"].includes(n.status)) && <p className="px-2 text-[12.5px] text-dim">None open.</p>}
      </Group>
      <Group title="Shortcuts">
        <Link href="/orders" className="block rounded-lg px-2 py-1.5 text-mist hover:bg-white/5 hover:text-porcelain">Orders</Link>
        <Link href="/agents" className="block rounded-lg px-2 py-1.5 text-mist hover:bg-white/5 hover:text-porcelain">Preferences & limits</Link>
      </Group>
    </nav>
  );

  const center = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b hairline px-5 py-3">
        <div className="min-w-0">
          <p className="truncate text-[14px] font-medium">{conv.data?.conversation.title ?? "New shopping task"}</p>
          <p className="text-[11.5px] text-dim">{conv.data?.conversation.agent ? <>Agent · {conv.data.conversation.agent.name}</> : convId ? "No agent · you approve every purchase" : "Pick an agent or shop yourself"}</p>
        </div>
        {!convId && (
          <select className="field !h-8 !w-auto text-[12.5px]" value={agentId} onChange={(e) => setAgentId(e.target.value)} aria-label="Agent">
            <option value="">No agent (research only)</option>
            {buyerAgents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </select>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-6">
        {cfg.data && !cfg.data.aiConfigured && (
          <div className="mx-auto mb-6 max-w-xl rounded-2xl border border-warn/30 bg-warn/5 p-4 text-[13px]">
            <p className="font-medium text-warn">AI is not configured on this server</p>
            <p className="mt-1 text-mist">OPENAI_API_KEY is missing, so the shopping agent can't run. Everything else works: you can still negotiate directly with seller agents from any negotiable product, and check out manually.</p>
          </div>
        )}
        {negotiateProduct || negotiationId ? (
          <NegotiationPanel productId={negotiateProduct} negotiationId={negotiationId} />
        ) : !convId ? (
          <div className="mx-auto max-w-xl pt-8 text-center">
            <div className="mx-auto grid size-12 place-items-center rounded-full bg-evergreen text-champagne"><Spark size={20} /></div>
            <h1 className="display mt-6 text-[42px]">What are you looking for?</h1>
            <p className="mt-2 text-mist">Describe it. Your agent searches live listings, checks sellers, negotiates and prepares checkout within your limits.</p>
            <div className="mt-8 grid gap-2 sm:grid-cols-2">
              {EXAMPLES.map((e) => <button key={e} onClick={() => send(e)} className="surface rounded-xl px-4 py-3 text-left text-[13.5px] text-porcelain/85 hover:border-line-2">{e}</button>)}
            </div>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-5">
            <AnimatePresence initial={false}>
              {msgs.map((m, i) => <MessageView key={m.id} m={m} live={working && i === msgs.length - 1} />)}
            </AnimatePresence>
            {working && <Working step={conv.data?.task?.step} onCancel={() => api(`/tasks/${conv.data!.task!.id}/cancel`, { json: {} }).then(() => conv.refetch())} />}
            <div ref={bottom} />
          </div>
        )}
      </div>

      {!negotiateProduct && !negotiationId && (
        <form className="border-t hairline p-4" onSubmit={(e) => { e.preventDefault(); void send(draft); }}>
          <div className="surface mx-auto flex max-w-2xl items-end gap-2 rounded-2xl p-2 focus-within:border-champagne/40">
            <textarea
              rows={1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(draft); } }}
              placeholder={working ? "Your agent is working…" : "Ask your agent to find, compare or negotiate…"}
              disabled={working}
              className="max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[14.5px] outline-none placeholder:text-dim"
              aria-label="Message"
            />
            <button className="btn btn-primary !h-10 !w-10 !p-0" disabled={working || !draft.trim()} aria-label="Send"><Send size={16} /></button>
          </div>
        </form>
      )}
    </div>
  );

  const right = <IntelligencePanel intel={latestIntel} working={working} autonomous={cfg.data?.autonomousPaymentsEnabled ?? false} />;

  return (
    <div className="mx-auto h-[calc(100dvh-64px-30px)] max-w-[1600px]">
      {/* mobile tabs */}
      <div className="flex border-b hairline lg:hidden">
        {(["tasks", "chat", "intel"] as const).map((t) => (
          <button key={t} onClick={() => setMobileTab(t)} className={`flex-1 py-2.5 text-[13px] ${mobileTab === t ? "border-b border-champagne text-porcelain" : "text-mist"}`}>{t === "tasks" ? "Tasks" : t === "chat" ? "Agent" : "Intelligence"}</button>
        ))}
      </div>
      <div className="grid h-[calc(100%-42px)] lg:h-full lg:grid-cols-[260px_1fr_380px]">
        <aside className={`${mobileTab === "tasks" ? "block" : "hidden"} min-h-0 border-r hairline lg:block`}>{left}</aside>
        <section className={`${mobileTab === "chat" ? "flex" : "hidden"} min-h-0 flex-col lg:flex`}>{center}</section>
        <aside className={`${mobileTab === "intel" ? "block" : "hidden"} min-h-0 overflow-y-auto border-l hairline bg-obsidian-2/40 lg:block`}>{right}</aside>
      </div>
    </div>
  );
}

function Group({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-2"><p className="eyebrow">{title}</p>{action}</div>
      <div className="space-y-0.5">{children}</div>
    </div>
  );
}

function MessageView({ m, live }: { m: Msg; live: boolean }) {
  if (m.role === "event")
    return (
      <motion.p initial={{ opacity: 0, x: -4 }} animate={{ opacity: 1, x: 0 }} className="flex items-center gap-2 pl-11 text-[12px] text-sage">
        <span className={`size-1.5 rounded-full ${live ? "animate-pulse bg-champagne" : "bg-sage/60"}`} /> {m.content}
      </motion.p>
    );
  if (m.role === "error") return <p className="rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">{m.content}</p>;
  const user = m.role === "user";
  return (
    <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className={`flex gap-3 ${user ? "flex-row-reverse" : ""}`}>
      <div className={`grid size-8 shrink-0 place-items-center rounded-full text-[11px] ${user ? "bg-porcelain/10" : "bg-evergreen text-champagne"}`}>{user ? "You" : <Bot size={14} />}</div>
      <div className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-[14px] leading-relaxed ${user ? "rounded-tr-sm bg-porcelain/[0.07]" : "rounded-tl-sm"}`}>
        <RichText text={m.content} />
        <p className="mt-1 text-[10.5px] text-dim">{timeAgo(m.createdAt)}</p>
      </div>
    </motion.div>
  );
}

/** Renders markdown-ish links the agent returns (e.g. checkout links) as in-app links only. */
function RichText({ text }: { text: string }) {
  const parts = text.split(/(\[[^\]]+\]\(\/[^)\s]+\)|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((p, i) => {
        const link = p.match(/^\[([^\]]+)\]\((\/[^)\s]+)\)$/);
        if (link) return <Link key={i} href={link[2]} className="text-champagne underline underline-offset-2">{link[1]}</Link>;
        const bold = p.match(/^\*\*([^*]+)\*\*$/);
        if (bold) return <strong key={i} className="font-medium">{bold[1]}</strong>;
        return <span key={i}>{p}</span>;
      })}
    </>
  );
}

function Working({ step, onCancel }: { step?: string | null; onCancel: () => void }) {
  return (
    <div className="flex items-center gap-3 pl-11">
      <div className="flex gap-1">{[0, 1, 2].map((i) => <motion.span key={i} className="size-1.5 rounded-full bg-champagne" animate={{ opacity: [0.2, 1, 0.2] }} transition={{ duration: 1.2, repeat: Infinity, delay: i * 0.2 }} />)}</div>
      <span className="text-[12.5px] text-mist">{step ?? "Working"}…</span>
      <button className="text-[12px] text-dim hover:text-porcelain" onClick={onCancel}>Stop</button>
    </div>
  );
}
