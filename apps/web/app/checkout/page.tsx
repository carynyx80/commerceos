"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { erc20Abi, type Hex } from "viem";
import { useAccount, useSwitchChain, useWriteContract } from "wagmi";
import { getPublicClient } from "wagmi/actions";
import { commerceEscrowAbi, explorerTx } from "@commerce-os/blockchain";
import { ASSETS, NETWORK_LABEL, formatUnits, formatUsd, type PaymentAsset } from "@commerce-os/shared";
import { useCart, type CartLine } from "@/components/cart";
import { Check, Lock } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { useSession } from "@/components/session";
import { useToast } from "@/components/toast";
import { ConnectButton } from "@/components/wallet/connect-button";
import { api, ApiError } from "@/lib/api";
import type { ProductDetail } from "@/lib/types";
import { chainIdForAsset, payableAssets, wagmiConfig } from "@/lib/wagmi";

type Asset = PaymentAsset;
type Step = "idle" | "quoting" | "approving" | "paying" | "confirming" | "funded" | "error";

interface QuoteRes {
  orderId: string;
  escrow: Hex;
  stable: Hex;
  stableDecimals: number;
  nativeSymbol: string;
  chainId: number;
  quote: { orderId: Hex; buyer: Hex; seller: Hex; token: Hex; amount: string; deadline: string; termsHash: Hex };
  signature: Hex;
  totalCents: number;
  feeBps: number;
  asset: Asset;
  nativeUsdPrice8: string | null;
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
  const options = payableAssets(p.acceptedAssets);
  const [asset, setAsset] = useState<Asset>(options.includes(defaultAsset) ? defaultAsset : (options[0] ?? p.acceptedAssets[0]));
  const [step, setStep] = useState<Step>("idle");
  const [quote, setQuote] = useState<QuoteRes | null>(null);
  const [tx, setTx] = useState<Hex | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [shipping, setShipping] = useState({ name: "", line1: "", city: "", postalCode: "", country: "" });
  const { address, chainId } = useAccount();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const toast = useToast();
  const qc = useQueryClient();
  const { remove } = useCart();
  const needsShipping = p.deliveryType === "PHYSICAL";
  const shippingOk = !needsShipping || (shipping.name && shipping.line1 && shipping.city && shipping.postalCode && shipping.country);

  async function run() {
    setErr(null);
    try {
      // Check the wallet before asking for a quote, so no stock is reserved for a payment that can't be sent.
      if (!address) throw new Error("Your wallet is disconnected. Reconnect it from the wallet menu (top right), then try again.");
      const target = chainIdForAsset(asset);
      if (!target) throw new Error(`${asset} is not available on this deployment.`);
      // Each asset settles on its own network: USDG/ETH on Robinhood Chain, USDC/BNB on BNB Chain.
      if (chainId !== target) await switchChainAsync({ chainId: target });
      const client = getPublicClient(wagmiConfig, { chainId: target });
      setStep("quoting");
      const q = await api<QuoteRes>("/checkout/quote", {
        json: { productId: p.id, quantity: line.quantity, asset, negotiationId, shipping: needsShipping ? shipping : undefined },
      });
      setQuote(q);
      const args = [{ ...q.quote, amount: BigInt(q.quote.amount), deadline: BigInt(q.quote.deadline) }, q.signature] as const;
      let hash: Hex;
      if (q.chainId !== target) throw new Error("Quote is for a different network. Try again.");
      if (ASSETS[asset].kind === "stable") {
        const allowance = await client!.readContract({ address: q.stable, abi: erc20Abi, functionName: "allowance", args: [address!, q.escrow] });
        if (allowance < BigInt(q.quote.amount)) {
          setStep("approving");
          const ah = await writeContractAsync({ address: q.stable, abi: erc20Abi, functionName: "approve", args: [q.escrow, BigInt(q.quote.amount)], chainId: target });
          await client!.waitForTransactionReceipt({ hash: ah });
        }
        setStep("paying");
        hash = await writeContractAsync({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithToken", args, chainId: target });
      } else {
        setStep("paying");
        // payWithEth is the escrow's native-coin path: ETH on Robinhood Chain, BNB on BNB Chain.
        hash = await writeContractAsync({ address: q.escrow, abi: commerceEscrowAbi, functionName: "payWithEth", args, value: BigInt(q.quote.amount), chainId: target });
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
          <div className="mt-3 flex flex-wrap gap-2">
            {options.map((a) => (
              <button key={a} disabled={busy || step === "funded"} onClick={() => setAsset(a)} className={`chip num !h-7 !px-3 ${asset === a ? "!border-champagne/60 !text-champagne" : ""}`} aria-pressed={asset === a} title={NETWORK_LABEL[ASSETS[a].network]}>
                {a} <span className="text-[10px] text-dim">{ASSETS[a].network === "bnb" ? "BNB Chain" : "Robinhood"}</span>
              </button>
            ))}
            {options.length === 0 && <span className="text-[12px] text-warn">None of this listing's payment assets are available here.</span>}
          </div>
        </div>
        <div className="text-right">
          <p className="num text-[20px]">{quote ? formatUsd(quote.totalCents) : negotiationId ? "Negotiated" : formatUsd(p.priceCents * line.quantity)}</p>
          {quote && (
            <p className="num mt-1 text-[12px] text-mist">
              {ASSETS[quote.asset].kind === "stable" ? `${formatUnits(BigInt(quote.quote.amount), quote.stableDecimals, 2)} ${quote.asset}` : `${formatUnits(BigInt(quote.quote.amount), 18, 6)} ${quote.asset}`}
            </p>
          )}
          {quote?.nativeUsdPrice8 && <p className="num text-[11px] text-dim">at ${formatUnits(BigInt(quote.nativeUsdPrice8), 8, 2)}/{quote.nativeSymbol}</p>}
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
            {tx && quote && <> · {explorerTx(quote.chainId, tx) ? <a className="num text-sage" href={explorerTx(quote.chainId, tx)!} target="_blank" rel="noreferrer">tx {tx.slice(0, 10)}…</a> : <span className="num">tx {tx.slice(0, 10)}…</span>}</>}
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
  { key: "approving", label: (a) => (ASSETS[a].kind === "stable" ? `Approve ${a}` : "No approval needed") },
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
