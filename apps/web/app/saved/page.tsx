"use client";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { ProductCard } from "@/components/product-card";
import { SignInGate } from "@/components/sign-in-gate";
import { api } from "@/lib/api";
import type { ProductCard as P } from "@/lib/types";

export default function SavedPage() {
  return <SignInGate title="Saved products"><Saved /></SignInGate>;
}

function Saved() {
  const q = useQuery({ queryKey: ["saved"], queryFn: () => api<{ items: P[] }>("/saved") });
  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <p className="eyebrow">Collection</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Saved</h1>
      {!q.data?.items.length ? (
        <p className="mt-10 text-mist">{q.isLoading ? "Loading…" : <>Nothing saved yet. Tap the heart on any product. <Link href="/explore" className="text-champagne">Explore</Link></>}</p>
      ) : (
        <div className="mt-10 grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">{q.data.items.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}</div>
      )}
    </div>
  );
}
