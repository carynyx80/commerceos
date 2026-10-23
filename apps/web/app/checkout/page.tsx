"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { erc20Abi, type Hex } from "viem";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { commerceEscrowAbi, explorerTx } from "@commerce-os/blockchain";
import { formatUnits, formatUsd } from "@commerce-os/shared";
import { useCart, type CartLine } from "@/components/cart";
import { Check, Lock } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { ConnectButton } from "@/components/wallet/connect-button";
import { api, ApiError } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";
import { CHAIN_ID } from "@/lib/wagmi";

type Asset = "USDG" | "ETH";
type Step = "idle" | "quoting" | "approving" | "paying" | "confirming" | "funded" | "error";

interface QuoteRes {
  orderId: string;
  escrow: Hex;
  usdg: Hex;
  chainId: number;
  quote: { orderId: Hex; buyer: Hex; seller: Hex; token: Hex; amount: string; deadline: string; termsHash: Hex };
  signature: Hex;
  totalCents: number;
  feeBps: number;
  asset: Asset;
  ethUsdPrice8: string | null;
}

export default function CheckoutPage() {
  return (
    <Suspense>
      <Checkout />
    </Suspense>
  );
}

function Checkout() {
  const sp = useSearchParams();
  const { lines } = useCart();
  const { me } = useSession();
  const single = sp.get("product");
  const product = useQuery({
    queryKey: ["product", single],
    enabled: !!single,
    queryFn: () => api<ProductDetail>(`/catalog/products/${single}`),
  });

  const items: CartLine[] = single
    ? product.data
      ? [{ productId: product.data.id, quantity: Math.max(1, Number(sp.get("qty") ?? 1)), product: product.data }]
      : []
    : lines;
  const negotiationId = sp.get("negotiation") ?? undefined;

  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-10 sm:px-6">
      <p className="eyebrow">Checkout</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Pay into escrow</h1>
      <p className="mt-3 max-w-xl text-mist">Each item is a separate escrow order with its seller. Funds are released only when you confirm delivery, or refunded if the seller cancels.</p>

      {!me ? (
        <div className="surface mt-10 rounded-2xl p-8 text-center">
          <Lock size={20} className="mx-auto text-champagne" />
          <p className="mt-4 font-medium">Connect and sign in to check out</p>
          <p className="mt-1 text-[13.5px] text-mist">Your wallet pays the escrow directly. Commerce OS never holds your keys.</p>
          <div className="mt-6 flex justify-center"><ConnectButton /></div>
        </div>
      ) : items.length === 0 ? (
        <div className="surface mt-10 rounded-2xl p-10 text-center text-mist">
          {single && product.isLoading ? "Loading…" : <>Nothing to check out. <Link href="/explore" className="text-champagne">Explore the marketplace</Link></>}
        </div>
      ) : (
        <div className="mt-10 space-y-4">
          {items.map((l) => (
            <CheckoutLine key={l.productId} line={l} defaultAsset={(sp.get("asset") as Asset) ?? l.product.acceptedAssets[0]} negotiationId={single ? negotiationId : undefined} />
          ))}
        </div>
      )}
    </div>
  );
}

function CheckoutLine({ line, defaultAsset, negotiationId }: { line: CartLine; defaultAsset: Asset; negotiationId?: string }) {
  const p = line.product;
  const [asset, setAsset] = useState<Asset>(p.acceptedAssets.includes(defaultAsset) ? defaultAsset : p.acceptedAssets[0]);
  const [step, setStep] = useState<Step>("idle");
  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shipping, setShipping] = useState({ name: "", line1: "", city: "", postalCode: "", country: "" });
  const { address, chainId } = useAccount();
  const client = usePublicClient();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const qc = useQueryClient();
  const { remove } = useCart();
  const needsShipping = p.deliveryType === "PHYSICAL";
  const shippingOk = !needsShipping || (shipping.name && shipping.line1 && shipping.city && shipping.postalCode && shipping.country);

  async function run() {
    setErr(null);
    try {
      if (chainId !== CHAIN_ID) throw new Error("Switch your wallet to the Commerce OS network first.");
      setStep("quoting");
      const q = await api<QuoteRes>("/checkout/quote", {
        json: { productId: p.id, quantity: line.quantity, asset, negotiationId, shipping: needsShipping ? shipping : undefined },
      });
      setQuote(q);
      const args = [{ ...q.quote, amount: BigInt(q.quote.amount), deadline: BigInt(q.quote.deadline) }, q.signature] as const;
      let hash: Hex;
      if (asset === "USDG") {
        const allowance = await client!.readContract({ address: q.usdg, abi: erc20Abi, functionName: "allowance", args: [address!, q.escrow] });
        if (allowance < BigInt(q.quote.amount)) {
          setStep("approving");
          const ah = await writeContractAsync({ address: q.usdg, abi: erc20Abi, functionName: "approve", args: [q.escrow, BigInt(q.quote.amount)] });
          await client!.waitForTransactionReceipt({ hash: ah });
        }
        setStep("paying");
        hash = await writeContractAsync({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithToken", args });
      } else {
        setStep("paying");
        hash = await writeContractAsync({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithEth", args, value: BigInt(q.quote.amount) });
      }
      setTx(hash);
      setStep("confirming");
      await api(`/orders/${q.orderId}/payment`, { json: { txHash: hash } });
      const receipt = await client!.waitForTransactionReceipt({ hash });
      if (receipt.status !== "success") throw new Error("The payment transaction reverted. No funds were taken except gas.");
      // The order becomes FUNDED only when the indexer confirms the escrow event.
      for (let i = 0; i < 90; i++) {
        const o = await api<{ state: string }>(`/orders/${q.orderId}`);
        if (o.state !== "AWAITING_PAYMENT") {
          setStep("funded");
          await remove(p.id).catch(() => {});
          await qc.invalidateQueries({ queryKey: ["orders"] });
          toast({ title: "Payment confirmed in escrow", body: p.title, tone: "ok" });
          return;
        }
        await new Promise((r) => setTimeout(r, 1500));
      }
      throw new Error("Your payment was sent but confirmation is taking longer than usual. Check Orders shortly.");
    } catch (e: any) {
      const msg = e instanceof ApiError ? e.message : (e?.shortMessage ?? e?.message ?? String(e));
      setErr(msg);
      setStep("error");
    }
  }

  const busy = ["quoting", "approving", "paying", "confirming"].includes(step);
  return (
    <motion.section layout className="surface overflow-hidden rounded-3xl">
      <div className="grid gap-6 p-5 sm:grid-cols-[96px_1fr_auto] sm:p-6">
        <div className="relative size-24 overflow-hidden rounded-2xl bg-evergreen/30">
          <ProductImage src={p.images[0]} alt={p.title} sizes="96px" />
        </div>
        <div className="min-w-0">
          <p className="font-medium">{p.title}</p>
          <p className="text-[13px] text-mist">{p.store.name} · qty <span className="num">{line.quantity}</span></p>
          <div className="mt-3 flex gap-2">
            {p.acceptedAssets.map((a) => (
              <button key={a} disabled={busy || step === "funded"} onClick={() => setAsset(a)} className={`chip num !h-7 !px-3 ${asset === a ? "!border-champagne/60 !text-champagne" : ""}`} aria-pressed={asset === a}>
                {a}
              </button>
            ))}
          </div>
        </div>
        <div className="text-right">
          <p className="num text-[20px]">{quote ? formatUsd(quote.totalCents) : negotiationId ? "Negotiated" : formatUsd(p.priceCents * line.quantity)}</p>
          {quote && (
            <p className="num mt-1 text-[12px] text-mist">
              {quote.asset === "USDG" ? `${formatUnits(BigInt(quote.quote.amount), 6, 2)} USDG` : `${formatUnits(BigInt(quote.quote.amount), 18, 6)} ETH`}
            </p>
          )}
          {quote?.ethUsdPrice8 && <p className="num text-[11px] text-dim">at ${formatUnits(BigInt(quote.ethUsdPrice8), 8, 2)}/ETH</p>}
        </div>
      </div>

      {needsShipping && step === "idle" && (
        <div className="grid gap-3 border-t hairline p-5 sm:grid-cols-2 sm:p-6">
          <p className="eyebrow sm:col-span-2">Delivery address · stored privately, never on-chain</p>
          {(["name", "line1", "city", "postalCode", "country"] as const).map((k) => (
            <input key={k} className={`field ${k === "line1" ? "sm:col-span-2" : ""}`} placeholder={{ name: "Full name", line1: "Street address", city: "City", postalCode: "Postal code", country: "Country" }[k]} value={shipping[k]} onChange={(e) => setShipping({ ...shipping, [k]: e.target.value })} aria-label={k} />
          ))}
        </div>
      )}

      <div className="border-t hairline p-5 sm:p-6">
        <Progress step={step} asset={asset} />
        <AnimatePresence>
          {err && (
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="mt-4 rounded-xl border border-danger/30 bg-danger/10 px-4 py-3 text-[13px] text-danger">
              {err}
            </motion.p>
          )}
        </AnimatePresence>
        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <p className="text-[12px] text-dim">
            {quote ? <>Fee {quote.feeBps / 100}% from the seller's proceeds · quote valid until {new Date(Number(quote.quote.deadline) * 1000).toLocaleTimeString()}</> : "You will sign a quote-locked payment. Prices are set by the server."}
            {tx && <> · {explorerTx(CHAIN_ID, tx) ? <a className="num text-sage" href={explorerTx(CHAIN_ID, tx)!} target="_blank" rel="noreferrer">tx {tx.slice(0, 10)}…</a> : <span className="num">tx {tx.slice(0, 10)}…</span>}</>}
          </p>
          {step === "funded" ? (
            <Link href={`/orders/${quote!.orderId}`} className="btn btn-secondary">View order</Link>
          ) : (
            <button className="btn btn-primary" onClick={run} disabled={busy || !shippingOk}>
              {busy ? "Working…" : step === "error" ? "Try again" : `Pay with ${asset}`}
            </button>
          )}
        </div>
      </div>
    </motion.section>
  );
}

const STEPS: { key: Step; label: (a: Asset) => string }[] = [
  { key: "quoting", label: () => "Server quote" },
  { key: "approving", label: (a) => (a === "USDG" ? "Approve USDG" : "No approval needed") },
  { key: "paying", label: () => "Sign payment" },
  { key: "confirming", label: () => "On-chain confirmation" },
  { key: "funded", label: () => "Funded in escrow" },
];

function Progress({ step, asset }: { step: Step; asset: Asset }) {
  const idx = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="grid grid-cols-5 gap-2">
      {STEPS.map((s, i) => {
        const done = idx > i || step === "funded";
        const active = idx === i && step !== "funded";
        return (
          <li key={s.key}>
            <div className="h-0.5 overflow-hidden rounded-full bg-porcelain/10">
              <motion.div className={`h-full ${done ? "bg-sage" : "bg-champagne"}`} initial={false} animate={{ width: done ? "100%" : active ? "60%" : "0%" }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }} />
            </div>
            <p className={`mt-2 flex items-center gap-1 text-[11.5px] ${done ? "text-sage" : active ? "text-porcelain" : "text-dim"}`}>
              {done && <Check size={11} />}
              <span className="truncate">{s.label(asset)}</span>
            </p>
          </li>
        );
      })}
    </ol>
  );
}
