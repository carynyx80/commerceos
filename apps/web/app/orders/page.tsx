"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { formatUsd } from "@commerce-os/shared";
import { Bot } from "@/components/icons";
import { OrderStateChip } from "@/components/order-state";
import { ProductImage } from "@/components/product-image";
import { SignInGate } from "@/components/sign-in-gate";
import { api } from "@/lib/api";
import { timeAgo } from "@/lib/format";
import type { OrderView } from "@/lib/types";

export default function OrdersPage() {
  return (
    <SignInGate title="Your orders">
      <Orders />
    </SignInGate>
  );
}

function Orders() {
  const q = useQuery({ queryKey: ["orders"], queryFn: () => api<{ items: OrderView[] }>("/orders"), refetchInterval: 5000 });
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-10 sm:px-6">
      <p className="eyebrow">Purchases</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Orders</h1>
      {q.isLoading ? (
        <p className="mt-10 text-mist">Loading…</p>
      ) : !q.data?.items.length ? (
        <div className="surface mt-10 rounded-2xl p-10 text-center text-mist">No orders yet. <Link href="/explore" className="text-champagne">Start exploring</Link></div>
      ) : (
        <ul className="mt-10 divide-y divide-line border-y hairline">
          {q.data.items.map((o) => (
            <li key={o.id}>
              <Link href={`/orders/${o.id}`} className="grid grid-cols-[56px_1fr_auto] items-center gap-4 py-4 transition-colors hover:bg-porcelain/[0.02] sm:grid-cols-[64px_1fr_auto_auto]">
                <div className="relative size-14 overflow-hidden rounded-xl bg-evergreen/30 sm:size-16"><ProductImage src={o.product.images[0]} alt="" sizes="64px" /></div>
                <div className="min-w-0">
                  <p className="truncate font-medium">{o.product.title}</p>
                  <p className="text-[12.5px] text-mist">{o.store.name} · {timeAgo(o.createdAt)} {o.byAgent && <span className="ml-1 inline-flex items-center gap-1 text-champagne"><Bot size={11} /> agent</span>}</p>
                </div>
                <div className="hidden sm:block"><OrderStateChip state={o.state} /></div>
                <div className="text-right">
                  <p className="num">{formatUsd(o.totalCents)}</p>
                  <p className="num text-[11px] text-dim">{o.asset}</p>
                  <div className="mt-1 sm:hidden"><OrderStateChip state={o.state} /></div>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
