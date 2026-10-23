"use client";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { Bot, Check } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";

interface NegView {
  id: string;
  status: string;
  productId: string;
  productTitle: string;
  listPriceCents: number;
  storeName: string;
  quantity: number;
  asset: "USDG" | "ETH";
  agreedCents: number | null;
  expiresAt: string;
  sellerAgentActive: boolean;
  offers: { id: string; from: "BUYER" | "SELLER"; priceCents: number; message: string; status: string; byAgent: boolean; termsHash: string; expiresAt: string; createdAt: string }[];
}

/** Structured offer/counter flow with the seller (or the seller's agent). */
export function NegotiationPanel({ productId, negotiationId }: { productId: string | null; negotiationId: string | null }) {
  const router = useRouter();
  const toast = useToast();
  const [asset, setAsset] = useState<"USDG" | "ETH">("USDG");
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const product = useQuery({ queryKey: ["product", productId], enabled: !!productId && !negotiationId, queryFn: () => api<ProductDetail>(`/catalog/products/${productId}`) });
  const neg = useQuery({
    queryKey: ["negotiation", negotiationId],
    enabled: !!negotiationId,
    queryFn: () => api<NegView>(`/negotiations/${negotiationId}`),
    refetchInterval: (q) => (q.state.data?.status === "OPEN" ? 1500 : false),
  });

  async function start() {
    setBusy(true);
    try {
      const n = await api<{ id: string }>("/negotiations", { json: { productId, quantity: 1, asset } });
      router.replace(`/workspace?negotiation=${n.id}`);
    } catch (e: any) {
      toast({ title: "Could not start negotiation", body: e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }
  async function act(path: string, json: unknown = {}) {
    setBusy(true);
    try {
      await api(`/negotiations/${negotiationId}/${path}`, { json });
      setPrice("");
      await neg.refetch();
    } catch (e: any) {
      toast({ title: "Not sent", body: e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  if (!negotiationId) {
    const p = product.data;
    if (!p) return <p className="text-center text-mist">{product.isLoading ? "Loading…" : "Product not found."}</p>;
    return (
      <div className="mx-auto max-w-xl">
        <Header title={p.title} store={p.store.name} image={p.images[0]} list={p.priceCents} />
        {!p.negotiable ? (
          <p className="mt-6 text-mist">This listing isn't open to negotiation. <Link href={`/product/${p.id}`} className="text-champagne">Buy at list price</Link></p>
        ) : (
          <div className="surface mt-6 rounded-2xl p-5">
            <p className="text-[13.5px] text-mist">Open a structured negotiation with {p.store.name}. Offers are signed into a terms hash, expire, and the seller answers within limits they set.</p>
            <div className="mt-4 flex gap-2">
              {p.acceptedAssets.map((a) => <button key={a} onClick={() => setAsset(a)} className={`chip num !h-8 !px-3 ${asset === a ? "!border-champagne/60 !text-champagne" : ""}`}>{a}</button>)}
            </div>
            <button className="btn btn-primary mt-5" disabled={busy} onClick={start}>Start negotiation</button>
          </div>
        )}
      </div>
    );
  }

  const n = neg.data;
  if (!n) return <p className="text-center text-mist">{neg.isLoading ? "Loading…" : "Negotiation not found."}</p>;
  const last = n.offers.at(-1);
  const awaitingSeller = n.status === "OPEN" && last?.from === "BUYER" && last.status === "PENDING";
  const counterPending = n.status === "OPEN" && last?.from === "SELLER" && last.status === "PENDING";

  return (
    <div className="mx-auto max-w-xl">
      <Header title={n.productTitle} store={n.storeName} list={n.listPriceCents} />
      <p className="mt-3 text-[12px] text-dim">
        {n.sellerAgentActive ? <><Bot size={11} className="mr-1 inline text-champagne" />The seller's agent responds within the merchant's limits.</> : "The seller responds personally; you'll be notified."} · settles in {n.asset}
      </p>
      <ol className="mt-6 space-y-3">
        <AnimatePresence initial={false}>
          {n.offers.map((o) => (
            <motion.li key={o.id} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className={`rounded-2xl border p-4 ${o.from === "SELLER" ? "mr-10 border-sage/25 bg-evergreen/30" : "ml-10 hairline"}`}>
              <div className="flex items-center justify-between">
                <span className="text-[12px] text-mist">{o.from === "SELLER" ? (o.byAgent ? `${n.storeName} agent` : n.storeName) : "Your offer"}</span>
                <span className="num text-[17px]">{formatUsd(o.priceCents)}</span>
              </div>
              {o.message && <p className="mt-1.5 text-[13.5px] text-porcelain/85">{o.message}</p>}
              <p className="num mt-2 text-[10.5px] text-dim">{o.status.toLowerCase()} · terms {o.termsHash.slice(0, 10)}… · expires {new Date(o.expiresAt).toLocaleTimeString()}</p>
            </motion.li>
          ))}
        </AnimatePresence>
      </ol>

      {awaitingSeller && (
        <p className="mt-4 flex items-center gap-2 text-[13px] text-sage"><span className="size-1.5 animate-pulse rounded-full bg-champagne" /> Waiting for seller response…</p>
      )}

      {n.status === "ACCEPTED" && n.agreedCents && (
        <div className="mt-6 rounded-2xl border border-ok/30 bg-ok/5 p-5">
          <p className="flex items-center gap-2 font-medium text-ok"><Check size={15} /> Agreed at {formatUsd(n.agreedCents)}</p>
          <p className="mt-1 text-[12.5px] text-mist">Check out before {new Date(n.expiresAt).toLocaleTimeString()} to lock this price.</p>
          <Link href={`/checkout?product=${n.productId}&qty=${n.quantity}&asset=${n.asset}&negotiation=${n.id}`} className="btn btn-primary mt-4">Check out at {formatUsd(n.agreedCents)}</Link>
        </div>
      )}
      {["REJECTED", "EXPIRED", "CANCELLED", "CONVERTED"].includes(n.status) && (
        <p className="mt-6 text-[13.5px] text-mist">This negotiation is {n.status.toLowerCase()}.{n.status !== "CONVERTED" && <> <Link href={`/product/${n.productId}`} className="text-champagne">View product</Link></>}</p>
      )}

      {n.status === "OPEN" && !awaitingSeller && (
        <div className="surface mt-6 rounded-2xl p-4">
          {counterPending && (
            <button className="btn btn-primary mb-3 w-full" disabled={busy} onClick={() => act("accept")}>Accept {formatUsd(last!.priceCents)}</button>
          )}
          <div className="flex gap-2">
            <div className="flex flex-1 items-center rounded-xl border hairline px-3">
              <span className="text-dim">$</span>
              <input className="num h-11 flex-1 bg-transparent px-2 outline-none" inputMode="decimal" placeholder={counterPending ? "Counter" : "Your offer"} value={price} onChange={(e) => setPrice(e.target.value.replace(/[^0-9.]/g, ""))} aria-label="Offer amount in USD" />
            </div>
            <button className="btn btn-secondary !h-11" disabled={busy || !price} onClick={() => act("offers", { priceCents: Math.round(Number(price) * 100) })}>{counterPending ? "Counter" : "Send offer"}</button>
          </div>
          <button className="mt-3 text-[12px] text-dim hover:text-porcelain" onClick={() => act("reject")}>Withdraw</button>
        </div>
      )}
    </div>
  );
}

function Header({ title, store, image, list }: { title: string; store: string; image?: string; list: number }) {
  return (
    <div className="flex items-center gap-4">
      {image && <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-evergreen/30"><ProductImage src={image} alt="" sizes="64px" /></div>}
      <div className="min-w-0">
        <p className="eyebrow">Negotiation</p>
        <p className="display mt-1 truncate text-[28px]">{title}</p>
        <p className="text-[12.5px] text-mist">{store} · list <span className="num">{formatUsd(list)}</span></p>
      </div>
    </div>
  );
}
