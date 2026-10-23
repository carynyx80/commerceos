"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatUsd } from "@commerce-os/shared";
import { useCart } from "@/components/cart";
import { Bot, Check, Lock, Minus, Plus, Shield, Store } from "@/components/icons";
import { ProductImage } from "@/components/product-image";
import { SaveButton } from "@/components/save-button";
import { useToast } from "@/components/toast";
import { timeAgo } from "@/lib/format";
import type { ProductDetail } from "@/lib/types";

export function ProductView({ p }: { p: ProductDetail }) {
  const [img, setImg] = useState(0);
  const [qty, setQty] = useState(1);
  const [asset, setAsset] = useState<"USDG" | "ETH">(p.acceptedAssets[0]);
  const { add } = useCart();
  const toast = useToast();
  const router = useRouter();
  const out = p.available <= 0;
  const images = p.images.length ? p.images : [""];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-8 sm:px-6 lg:px-10">
      <nav className="mb-6 text-[12.5px] text-dim" aria-label="Breadcrumb">
        <Link href="/explore" className="hover:text-porcelain">Explore</Link> <span className="mx-1.5">/</span>
        <Link href={`/explore?category=${encodeURIComponent(p.category)}`} className="hover:text-porcelain">{p.category}</Link>
      </nav>

      <div className="grid gap-10 lg:grid-cols-[1.15fr_1fr] lg:gap-16">
        {/* Gallery */}
        <div className="lg:sticky lg:top-24 lg:self-start">
          <div className="relative aspect-[4/5] overflow-hidden rounded-3xl bg-evergreen/30 sm:aspect-[5/5]">
            <AnimatePresence mode="popLayout">
              <motion.div key={img} className="absolute inset-0" initial={{ opacity: 0, scale: 1.02 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}>
                <ProductImage src={images[img]} alt={p.title} sizes="(max-width: 1024px) 100vw, 55vw" priority />
              </motion.div>
            </AnimatePresence>
            <div className="absolute right-4 top-4"><SaveButton productId={p.id} /></div>
            {p.isFixture && <span className="chip absolute left-4 top-4 !border-transparent bg-obsidian/70 backdrop-blur">Demo listing · development fixture</span>}
          </div>
          {images.length > 1 && (
            <div className="mt-3 flex gap-3">
              {images.map((src, i) => (
                <button key={i} onClick={() => setImg(i)} className={`relative size-20 overflow-hidden rounded-xl border transition ${i === img ? "border-champagne" : "hairline opacity-60 hover:opacity-100"}`} aria-label={`Image ${i + 1}`}>
                  <ProductImage src={src} alt="" sizes="80px" />
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Buy box */}
        <div>
          <Link href={`/store/${p.store.slug}`} className="inline-flex items-center gap-2 text-[13px] text-mist hover:text-porcelain">
            <Store size={14} /> {p.store.name}
            {p.store.verified && <span className="chip !h-5 !text-[10.5px] !text-sage"><Check size={10} /> Verified seller</span>}
          </Link>
          <h1 className="display mt-4 text-[clamp(36px,4vw,56px)]">{p.title}</h1>
          <div className="mt-5 flex items-baseline gap-4">
            <span className="num text-[28px]">{formatUsd(p.priceCents)}</span>
            {p.rating && <span className="text-[13px] text-mist"><span className="num">{p.rating.average.toFixed(1)}★</span> · {p.rating.count} verified {p.rating.count === 1 ? "review" : "reviews"}</span>}
          </div>
          <p className={`mt-2 text-[13px] ${out ? "text-danger" : p.available < 5 ? "text-warn" : "text-sage"}`}>
            {out ? "Out of stock" : p.available < 5 ? `Only ${p.available} left in stock` : `${p.available} in stock`}
          </p>

          <div className="mt-8 space-y-5 border-t hairline pt-8">
            <div>
              <p className="label">Pay with</p>
              <div className="flex gap-2" role="radiogroup">
                {p.acceptedAssets.map((a) => (
                  <button key={a} role="radio" aria-checked={asset === a} onClick={() => setAsset(a)} className={`num flex-1 rounded-xl border px-4 py-3 text-left text-[13px] transition ${asset === a ? "border-champagne/60 bg-champagne/[0.06]" : "hairline hover:border-line-2"}`}>
                    <span className="block text-porcelain">{a}</span>
                    <span className="text-[11.5px] text-dim">{a === "USDG" ? "Stablecoin · exact USD" : "Quoted at checkout"}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-3">
              <div className="flex h-12 items-center rounded-full border hairline">
                <button className="grid size-12 place-items-center text-mist hover:text-porcelain" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity"><Minus size={14} /></button>
                <span className="num w-8 text-center">{qty}</span>
                <button className="grid size-12 place-items-center text-mist hover:text-porcelain" onClick={() => setQty((q) => Math.min(Math.max(1, p.available), 99, q + 1))} aria-label="Increase quantity"><Plus size={14} /></button>
              </div>
              <button className="btn btn-secondary h-12 flex-1" disabled={out} onClick={() => add(p, qty).catch((e) => toast({ title: "Could not add to cart", body: e.message, tone: "error" }))}>
                Add to cart
              </button>
            </div>
            <button className="btn btn-primary h-12 w-full text-[15px]" disabled={out} onClick={() => router.push(`/checkout?product=${p.id}&qty=${qty}&asset=${asset}`)}>
              Buy now · {formatUsd(p.priceCents * qty)}
            </button>
            {p.negotiable ? (
              <Link href={`/workspace?negotiate=${p.id}`} className="btn btn-ghost h-11 w-full border hairline">
                <Bot size={15} className="text-champagne" /> Negotiate with AI
              </Link>
            ) : (
              <p className="text-center text-[12.5px] text-dim">This seller has not enabled negotiation for this listing.</p>
            )}
          </div>

          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <InfoCard icon={<Lock size={15} />} title="Escrow protected">
              Payment is held by the escrow contract and released to {p.store.name} when you confirm delivery.
            </InfoCard>
            <InfoCard icon={<Shield size={15} />} title={p.deliveryType === "DIGITAL" ? "Digital delivery" : "Shipping"}>
              {p.shippingInfo || "Shipping details are confirmed by the seller after payment."}
            </InfoCard>
          </div>

          <Section title="Description"><p className="whitespace-pre-line text-porcelain/85">{p.description}</p></Section>
          {Object.keys(p.specs).length > 0 && (
            <Section title="Specifications">
              <dl className="divide-y divide-line">
                {Object.entries(p.specs).map(([k, v]) => (
                  <div key={k} className="flex justify-between gap-6 py-2.5 text-[14px]">
                    <dt className="text-mist">{k}</dt>
                    <dd className="text-right">{v}</dd>
                  </div>
                ))}
              </dl>
            </Section>
          )}
          <Section title="Refunds & returns">
            <p className="text-porcelain/85">{p.store.returnPolicy || "This seller has not published a return policy."}</p>
            <p className="mt-3 text-[13px] text-mist">If the seller cancels or does not fulfil, the escrow returns your {asset} automatically. Disputes keep funds locked until an arbiter decides.</p>
          </Section>
          <Section title="Seller">
            <Link href={`/store/${p.store.slug}`} className="surface flex items-center gap-4 rounded-2xl p-4 hover:border-line-2">
              <div className="display grid size-12 place-items-center rounded-full bg-evergreen text-[20px] text-champagne">{p.store.name[0]}</div>
              <div className="min-w-0">
                <p className="font-medium">{p.store.name}</p>
                <p className="line-clamp-1 text-[13px] text-mist">{p.store.tagline}</p>
              </div>
            </Link>
          </Section>
          <Section title={`Verified reviews${p.reviews.length ? ` (${p.reviews.length})` : ""}`}>
            {p.reviews.length === 0 ? (
              <p className="text-[14px] text-mist">No reviews yet. Only buyers whose orders settled through escrow can leave one.</p>
            ) : (
              <ul className="space-y-4">
                {p.reviews.map((r) => (
                  <li key={r.id} className="border-b hairline pb-4">
                    <div className="flex items-center justify-between text-[12.5px]">
                      <span className="num text-champagne">{"★".repeat(r.rating)}<span className="text-dim">{"★".repeat(5 - r.rating)}</span></span>
                      <span className="text-dim"><span className="num">{r.author}</span> · {timeAgo(r.createdAt)}</span>
                    </div>
                    <p className="mt-2 text-[14px] text-porcelain/85">{r.body}</p>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mt-10 border-t hairline pt-8">
      <h2 className="eyebrow mb-4">{title}</h2>
      {children}
    </section>
  );
}
function InfoCard({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="surface rounded-2xl p-4">
      <p className="flex items-center gap-2 text-[13.5px] font-medium"><span className="text-sage">{icon}</span>{title}</p>
      <p className="mt-1.5 text-[12.5px] text-mist">{children}</p>
    </div>
  );
}
