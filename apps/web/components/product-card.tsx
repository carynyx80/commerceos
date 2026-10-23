"use client";
import { motion } from "motion/react";
import Link from "next/link";
import { formatUsd } from "@commerce-os/shared";
import type { ProductCard as P } from "@/lib/types";
import { ProductImage } from "./product-image";
import { Bot, Check } from "./icons";
import { SaveButton } from "./save-button";

export function ProductCard({ p, index = 0, priority }: { p: P; index?: number; priority?: boolean }) {
  const out = p.available <= 0;
  return (
    <motion.article
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={{ duration: 0.5, delay: Math.min(index, 8) * 0.04, ease: [0.22, 1, 0.36, 1] }}
      className="group relative"
    >
      <Link href={`/product/${p.id}`} className="block">
        <div className="relative aspect-[4/5] overflow-hidden rounded-2xl bg-evergreen/30">
          <ProductImage src={p.images[0]} alt={p.title} sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw" priority={priority} className="transition-transform duration-700 ease-[cubic-bezier(.22,1,.36,1)] group-hover:scale-[1.035]" />
          <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-obsidian/70 to-transparent opacity-0 transition-opacity duration-500 group-hover:opacity-100" />
          <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
            {p.negotiable && (
              <span className="chip !border-transparent bg-obsidian/70 !text-champagne backdrop-blur"><Bot size={11} /> Negotiable</span>
            )}
            {p.isFixture && <span className="chip !border-transparent bg-obsidian/70 backdrop-blur">Demo listing</span>}
          </div>
          {out && <div className="absolute inset-0 grid place-items-center bg-obsidian/60 text-[13px] text-mist">Sold out</div>}
        </div>
      </Link>
      <div className="absolute right-3 top-3"><SaveButton productId={p.id} /></div>
      <div className="mt-3 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href={`/product/${p.id}`} className="line-clamp-1 text-[14.5px] font-medium hover:text-champagne">{p.title}</Link>
          <Link href={`/store/${p.store.slug}`} className="mt-0.5 flex items-center gap-1 text-[12.5px] text-mist hover:text-porcelain">
            <span className="truncate">{p.store.name}</span>
            {p.store.verified && <Check size={12} className="shrink-0 text-sage" aria-label="Verified seller" />}
          </Link>
        </div>
        <div className="shrink-0 text-right">
          <p className="num text-[14.5px]">{formatUsd(p.priceCents)}</p>
          <p className="num mt-0.5 whitespace-nowrap text-[10.5px] text-dim">{p.acceptedAssets.join(" · ")}</p>
        </div>
      </div>
      <p className="mt-1 text-[11.5px] text-dim">
        {out ? "Out of stock" : p.available < 5 ? `Only ${p.available} left` : "In stock"}
        {p.rating && <> · <span className="num">{p.rating.average.toFixed(1)}★</span> ({p.rating.count})</>}
      </p>
    </motion.article>
  );
}
