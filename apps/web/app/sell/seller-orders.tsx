"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { Bot } from "@/components/icons";
import { OrderStateChip } from "@/components/order-state";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { shortAddr, timeAgo } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import type { MyStore } from "./page";

export function SellerOrders({ store }: { store: MyStore }) {
  const q = useQuery({ queryKey: ["seller-orders", store.id], queryFn: () => api<{ items: (OrderView & { shipping: any })[] }>(`/merchant/orders?storeId=${store.id}`), refetchInterval: 5000 });
  if (!q.data?.items.length) return <div className="surface rounded-2xl p-10 text-center text-mist">{q.isLoading ? "Loading…" : "No paid orders yet. Orders appear here once payment is confirmed in escrow."}</div>;
  return (
    <ul className="space-y-3">
      {q.data.items.map((o) => <OrderRow key={o.id} o={o} />)}
    </ul>
  );
}

function OrderRow({ o }: { o: OrderView & { shipping: any } }) {
  const [tracking, setTracking] = useState(o.trackingInfo ?? "");
  const toast = useToast();
  return (
    <li className="surface rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/orders/${o.id}`} className="font-medium hover:text-champagne">{o.product.title}</Link>
          <p className="text-[12px] text-mist">qty <span className="num">{o.quantity}</span> · buyer <span className="num">{shortAddr(o.buyerAddress)}</span> · {timeAgo(o.createdAt)} {o.byAgent && <span className="ml-1 inline-flex items-center gap-1 text-champagne"><Bot size={11} /> agent</span>}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="num">{formatUsd(o.totalCents)} <span className="text-[11px] text-dim">{o.asset}</span></span>
          <OrderStateChip state={o.state} />
          <Link href={`/orders/${o.id}`} className="btn btn-secondary btn-sm">{o.state === "FUNDED" ? "Accept" : ["ACCEPTED", "IN_FULFILLMENT"].includes(o.state) ? "Fulfil" : "Open"}</Link>
        </div>
      </div>
      {["ACCEPTED", "IN_FULFILLMENT"].includes(o.state) && o.product.deliveryType === "PHYSICAL" && (
        <div className="mt-3 flex gap-2 border-t hairline pt-3">
          <input className="field !h-9 flex-1 text-[13px]" placeholder="Carrier and tracking number" value={tracking} onChange={(e) => setTracking(e.target.value)} />
          <button className="btn btn-secondary btn-sm !h-9" onClick={() => api(`/merchant/orders/${o.id}/tracking`, { method: "PATCH", json: { trackingInfo: tracking } }).then(() => toast({ title: "Tracking shared with buyer", tone: "ok" })).catch((e) => toast({ title: "Could not save", body: e.message, tone: "error" }))}>Save tracking</button>
        </div>
      )}
    </li>
  );
}
