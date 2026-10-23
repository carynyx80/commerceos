"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { use, useState } from "react";
import type { Hex } from "viem";
import { useAccount, useReadContract, useSwitchChain, useWriteContract } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { commerceEscrowAbi, deploymentFor, explorerTx } from "@commerce-os/blockchain";
import { ASSETS, ORDER_STATE_LABEL, formatUnits, formatUsd, type OrderState } from "@commerce-os/shared";
import { chainById } from "@commerce-os/blockchain";
import { Bot, Check, Shield } from "@/components/icons";
import { OrderStateChip } from "@/components/order-state";
import { ProductImage } from "@/components/product-image";
import { SignInGate } from "@/components/sign-in-gate";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import { shortAddr } from "@/lib/format";
import type { OrderView } from "@/lib/types";
import { wagmiConfig } from "@/lib/wagmi";

type Detail = OrderView & { role: "buyer" | "seller" | "admin"; shipping: Record<string, string> | null };

const FLOW: OrderState[] = ["AWAITING_PAYMENT", "FUNDED", "ACCEPTED", "FULFILLED", "RELEASED"];

export default function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  return (
    <SignInGate title="Order">
      <Order id={id} />
    </SignInGate>
  );
}

function Order({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["order", id], queryFn: () => api<Detail>(`/orders/${id}`), refetchInterval: 4000 });
  const orderChain = q.data?.chainId;
  const d = orderChain ? deploymentFor(orderChain) : null;
  const onchain = useReadContract({
    address: d?.escrow,
    abi: commerceEscrowAbi,
    functionName: "getOrder",
    args: q.data ? [q.data.onchainId as Hex] : undefined,
    chainId: orderChain,
    query: { enabled: !!q.data && !!d, refetchInterval: 6000 },
  });
  const windows = useReadContract({ address: d?.escrow, abi: commerceEscrowAbi, functionName: "acceptWindow", chainId: orderChain, query: { enabled: !!d } });
  if (q.isLoading) return <p className="px-4 py-32 text-center text-mist">Loading…</p>;
  if (q.isError || !q.data) return <p className="px-4 py-32 text-center text-mist">Order not found, or you do not have access.</p>;
  const o = q.data;
  const curIdx = FLOW.indexOf(o.state === "IN_FULFILLMENT" ? "ACCEPTED" : o.state);
  const fundedAt = onchain.data ? Number(onchain.data.fundedAt) : 0;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-10 sm:px-6">
      <Link href={o.role === "seller" ? "/sell/orders" : "/orders"} className="text-[13px] text-mist hover:text-porcelain">← {o.role === "seller" ? "Store orders" : "All orders"}</Link>
      <div className="mt-6 flex flex-wrap items-start justify-between gap-6">
        <div className="flex gap-5">
          <div className="relative size-20 overflow-hidden rounded-2xl bg-evergreen/30"><ProductImage src={o.product.images[0]} alt="" sizes="80px" /></div>
          <div>
            <h1 className="display text-[clamp(30px,3.6vw,46px)]">{o.product.title}</h1>
            <p className="text-[13px] text-mist"><Link href={`/store/${o.store.slug}`} className="hover:text-porcelain">{o.store.name}</Link> · qty <span className="num">{o.quantity}</span> {o.byAgent && <span className="ml-1 inline-flex items-center gap-1 text-champagne"><Bot size={12} /> bought by your agent</span>}</p>
          </div>
        </div>
        <OrderStateChip state={o.state} />
      </div>

      {/* timeline */}
      {!["CANCELLED", "REFUNDED", "DISPUTED"].includes(o.state) && (
        <ol className="mt-10 grid grid-cols-5 gap-2">
          {FLOW.map((s, i) => (
            <li key={s}>
              <div className={`h-0.5 rounded-full ${i <= curIdx ? "bg-champagne" : "bg-porcelain/10"}`} />
              <p className={`mt-2 text-[11.5px] ${i <= curIdx ? "text-porcelain" : "text-dim"}`}>{ORDER_STATE_LABEL[s]}</p>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-10 grid gap-6 lg:grid-cols-[1.3fr_1fr]">
        <div className="space-y-6">
          <Actions o={o} refetch={() => q.refetch()} fundedAt={fundedAt} acceptWindow={Number(windows.data ?? 0)} />
          <section className="surface rounded-2xl p-5">
            <h2 className="eyebrow mb-4">History · from confirmed chain events</h2>
            <ul className="space-y-3 text-[13.5px]">
              {o.transitions.map((t, i) => (
                <li key={i} className="flex items-center justify-between gap-4">
                  <span><span className="text-mist">{ORDER_STATE_LABEL[t.from as OrderState] ?? t.from}</span> → {ORDER_STATE_LABEL[t.to as OrderState] ?? t.to}</span>
                  <span className="num text-[11.5px] text-dim">
                    {t.txHash ? <TxLink hash={t.txHash} chainId={o.chainId} /> : t.source} · {new Date(t.createdAt).toLocaleString()}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </div>
        <aside className="space-y-6">
          <section className="surface rounded-2xl p-5 text-[13.5px]">
            <h2 className="eyebrow mb-4">Payment</h2>
            <Row k="Total" v={formatUsd(o.totalCents)} />
            <Row k="Network" v={chainById(o.chainId).name} />
            <Row k="Paid in" v={ASSETS[o.asset].kind === "stable" ? `${formatUnits(BigInt(o.amount), deploymentFor(o.chainId)?.stableDecimals ?? ASSETS[o.asset].defaultDecimals, 2)} ${o.asset}` : `${formatUnits(BigInt(o.amount), 18, 6)} ${o.asset}`} />
            <Row k="Protocol fee" v={`${o.feeBps / 100}% of seller proceeds`} />
            <Row k="Seller wallet" v={shortAddr(o.sellerAddress)} />
            <Row k="Escrow order" v={shortAddr(o.onchainId)} />
            {o.payments.map((p) => <Row key={p.txHash} k={`Payment · ${p.status.toLowerCase()}`} v={<TxLink hash={p.txHash} chainId={o.chainId} />} />)}
          </section>
          {o.shipping && (
            <section className="surface rounded-2xl p-5 text-[13.5px]">
              <h2 className="eyebrow mb-3">Delivery (private)</h2>
              <p>{o.shipping.name}<br />{o.shipping.line1}<br />{o.shipping.city} {o.shipping.postalCode}<br />{o.shipping.country}</p>
              {o.trackingInfo && <p className="mt-3 text-sage">Tracking: {o.trackingInfo}</p>}
            </section>
          )}
          {o.dispute && (
            <section className="rounded-2xl border border-danger/30 bg-danger/5 p-5 text-[13.5px]">
              <h2 className="eyebrow mb-2 !text-danger">Dispute · {o.dispute.status.toLowerCase()}</h2>
              <p className="text-porcelain/85">{o.dispute.reason}</p>
              <p className="mt-2 text-[12px] text-mist">Funds stay in escrow until an arbiter rules. Rulings can be appealed once.</p>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}

function Actions({ o, refetch, fundedAt, acceptWindow }: { o: Detail; refetch: () => void; fundedAt: number; acceptWindow: number }) {
  const d = deploymentFor(o.chainId)!;
  const { writeContractAsync } = useWriteContract();
  const { chainId: walletChain } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const client = getPublicClient(wagmiConfig, { chainId: o.chainId });
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [showDispute, setShowDispute] = useState(false);
  const [review, setReview] = useState({ rating: 5, body: "" });
  const id = o.onchainId as Hex;

  async function chain(label: string, fn: "confirmDelivery" | "buyerCancel" | "openDispute" | "accept" | "markFulfilled" | "sellerCancel") {
    setBusy(label);
    try {
      // Escrow actions happen on the order's own network.
      if (walletChain !== o.chainId) await switchChainAsync({ chainId: o.chainId });
      const h = await writeContractAsync({ address: d.escrow, abi: commerceEscrowAbi, functionName: fn, args: [id], chainId: o.chainId });
      const r = await client!.waitForTransactionReceipt({ hash: h });
      if (r.status !== "success") throw new Error("Transaction reverted");
      toast({ title: `${label} submitted`, body: "The order updates once the event is confirmed.", tone: "ok" });
      refetch();
    } catch (e: any) {
      toast({ title: `${label} failed`, body: e?.shortMessage ?? e?.message, tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  const isBuyer = o.role === "buyer";
  const isSeller = o.role === "seller";
  const canCancelTimeout = isBuyer && o.state === "FUNDED" && fundedAt > 0 && Date.now() / 1000 > fundedAt + acceptWindow;

  return (
    <section className="surface-raised rounded-2xl p-5">
      <h2 className="eyebrow mb-4">Next step</h2>
      {o.state === "AWAITING_PAYMENT" && <p className="text-mist">Waiting for your payment to confirm on-chain. If you didn't pay, this order expires automatically at {new Date(o.paymentDeadline).toLocaleTimeString()}.</p>}
      {isBuyer && o.state === "FUNDED" && <p className="text-mist">Your payment is locked in escrow. The seller has {Math.round(acceptWindow / 86400)} days to accept, otherwise you can cancel for a full refund.</p>}
      {isBuyer && ["ACCEPTED", "IN_FULFILLMENT"].includes(o.state) && <p className="text-mist">The seller accepted and is preparing your order.</p>}
      {isBuyer && o.state === "FULFILLED" && <p className="text-mist">The seller marked this fulfilled. Confirm once you have it to release payment. If you do nothing, payment releases automatically after the confirmation window.</p>}
      {o.state === "RELEASED" && <p className="flex items-center gap-2 text-ok"><Check size={15} /> Settled. The seller has been paid.</p>}
      {o.state === "REFUNDED" && <p className="text-mist">Refunded to the buyer's wallet in {o.asset}.</p>}
      {o.state === "CANCELLED" && <p className="text-mist">This order expired before payment. Nothing was charged.</p>}

      <div className="mt-5 flex flex-wrap gap-2">
        {isBuyer && ["FULFILLED", "ACCEPTED", "IN_FULFILLMENT"].includes(o.state) && (
          <button className="btn btn-primary" disabled={!!busy} onClick={() => chain("Confirm delivery", "confirmDelivery")}>{busy === "Confirm delivery" ? "Confirming…" : "Confirm delivery & release"}</button>
        )}
        {canCancelTimeout && <button className="btn btn-secondary" disabled={!!busy} onClick={() => chain("Cancel order", "buyerCancel")}>Cancel for refund</button>}
        {isSeller && o.state === "FUNDED" && <button className="btn btn-primary" disabled={!!busy} onClick={() => chain("Accept order", "accept")}>Accept order</button>}
        {isSeller && ["ACCEPTED", "IN_FULFILLMENT"].includes(o.state) && <button className="btn btn-primary" disabled={!!busy} onClick={() => chain("Mark fulfilled", "markFulfilled")}>Mark fulfilled</button>}
        {isSeller && ["FUNDED", "ACCEPTED", "IN_FULFILLMENT"].includes(o.state) && <button className="btn btn-ghost" disabled={!!busy} onClick={() => chain("Cancel & refund", "sellerCancel")}>Cancel & refund buyer</button>}
        {(isBuyer || isSeller) && ["FUNDED", "ACCEPTED", "IN_FULFILLMENT", "FULFILLED"].includes(o.state) && !o.dispute && (
          <button className="btn btn-ghost" onClick={() => setShowDispute((v) => !v)}><Shield size={14} /> Open a dispute</button>
        )}
      </div>

      {showDispute && (
        <div className="mt-5 space-y-3 border-t hairline pt-5">
          <label className="label" htmlFor="reason">What went wrong? This is shared with the other party and the arbiter, never put on-chain.</label>
          <textarea id="reason" className="field" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
          <button
            className="btn btn-secondary"
            disabled={reason.trim().length < 10 || !!busy}
            onClick={async () => {
              try {
                await api(`/orders/${o.id}/dispute`, { json: { reason } });
                await chain("Open dispute", "openDispute");
                setShowDispute(false);
              } catch (e: any) {
                toast({ title: "Could not open dispute", body: e.message, tone: "error" });
              }
            }}
          >
            Lock funds and open dispute
          </button>
        </div>
      )}

      {isBuyer && o.state === "RELEASED" && (
        <div className="mt-5 space-y-3 border-t hairline pt-5">
          <p className="label">Leave a verified review</p>
          <div className="flex gap-1">
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} onClick={() => setReview({ ...review, rating: n })} className={`text-[20px] ${n <= review.rating ? "text-champagne" : "text-dim"}`} aria-label={`${n} stars`}>★</button>
            ))}
          </div>
          <textarea className="field" rows={2} value={review.body} onChange={(e) => setReview({ ...review, body: e.target.value })} placeholder="How was it?" />
          <button
            className="btn btn-secondary"
            disabled={review.body.trim().length < 3}
            onClick={() => api(`/orders/${o.id}/review`, { json: review }).then(() => toast({ title: "Review posted", tone: "ok" })).catch((e) => toast({ title: "Could not post review", body: e.message, tone: "error" }))}
          >
            Post review
          </button>
        </div>
      )}
    </section>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b hairline py-2 last:border-0">
      <span className="text-mist">{k}</span>
      <span className="num text-right">{v}</span>
    </div>
  );
}

function TxLink({ hash, chainId }: { hash: string; chainId: number }) {
  const url = explorerTx(chainId, hash);
  return url ? <a href={url} target="_blank" rel="noreferrer" className="text-sage hover:underline">{shortAddr(hash)}</a> : <span title={hash}>{shortAddr(hash)}</span>;
}
