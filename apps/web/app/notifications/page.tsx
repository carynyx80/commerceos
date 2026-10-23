"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect } from "react";
import { SignInGate } from "@/components/sign-in-gate";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";

interface N { id: string; kind: string; title: string; body: string; href: string | null; readAt: string | null; createdAt: string }

export default function NotificationsPage() {
  return <SignInGate title="Notifications"><Notifications /></SignInGate>;
}

function Notifications() {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["notifications"], queryFn: () => api<{ items: N[] }>("/notifications"), refetchInterval: 10_000 });
  useEffect(() => {
    if (q.data?.items.some((n) => !n.readAt)) {
      const t = setTimeout(() => api("/notifications/read-all", { json: {} }).then(() => qc.invalidateQueries({ queryKey: ["notifications", "unread"] })), 1500);
      return () => clearTimeout(t);
    }
  }, [q.data, qc]);
  return (
    <div className="mx-auto max-w-3xl px-4 pb-10 pt-10 sm:px-6">
      <p className="eyebrow">Inbox</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,60px)]">Notifications</h1>
      {!q.data?.items.length ? (
        <p className="mt-10 text-mist">{q.isLoading ? "Loading…" : "Nothing yet. Order updates, offers and agent activity show up here."}</p>
      ) : (
        <ul className="mt-10 divide-y divide-line border-y hairline">
          {q.data.items.map((n) => {
            const inner = (
              <div className="flex gap-4 py-4">
                <span className={`mt-2 size-1.5 shrink-0 rounded-full ${n.readAt ? "bg-transparent" : "bg-champagne"}`} />
                <div className="min-w-0 flex-1">
                  <div className="flex justify-between gap-3"><p className="font-medium">{n.title}</p><span className="shrink-0 text-[12px] text-dim">{timeAgo(n.createdAt)}</span></div>
                  <p className="mt-0.5 text-[13.5px] text-mist">{n.body}</p>
                </div>
              </div>
            );
            return <li key={n.id}>{n.href ? <Link href={n.href} className="block hover:bg-porcelain/[0.02]">{inner}</Link> : inner}</li>;
          })}
        </ul>
      )}
    </div>
  );
}
