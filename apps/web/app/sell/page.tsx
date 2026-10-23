"use client";
import { useQuery } from "@tanstack/react-query";
import { motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { SignInGate } from "@/components/sign-in-gate";
import { api } from "@/lib/api";
import { Onboarding } from "./onboarding";
import { Overview } from "./overview";
import { Products } from "./products";
import { SellerOrders } from "./seller-orders";
import { Offers } from "./offers";
import { SellerAgent } from "./seller-agent";
import { StoreSettings } from "./store-settings";

export interface MyStore {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  description: string;
  payoutAddress: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  returnPolicy: string;
  active: boolean;
}

const TABS = [
  ["overview", "Overview"],
  ["products", "Products"],
  ["orders", "Orders"],
  ["offers", "Offers"],
  ["agent", "Sales agent"],
  ["settings", "Store settings"],
] as const;

export default function SellPage() {
  return (
    <SignInGate title="Sell on Commerce OS">
      <Suspense>
        <Sell />
      </Suspense>
    </SignInGate>
  );
}

function Sell() {
  const sp = useSearchParams();
  const router = useRouter();
  const q = useQuery({ queryKey: ["my-stores"], queryFn: () => api<{ merchant: { id: string; verified: boolean } | null; stores: MyStore[] }>("/merchant/stores") });
  const [storeId, setStoreId] = useState<string | null>(null);
  const tab = (sp.get("tab") ?? "overview") as (typeof TABS)[number][0];
  useEffect(() => {
    if (!storeId && q.data?.stores[0]) setStoreId(q.data.stores[0].id);
  }, [q.data, storeId]);

  if (q.isLoading) return <p className="px-4 py-32 text-center text-mist">Loading…</p>;
  if (!q.data?.stores.length) return <Onboarding onCreated={(id) => { setStoreId(id); void q.refetch(); }} />;
  const store = q.data.stores.find((s) => s.id === storeId) ?? q.data.stores[0];

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-10 sm:px-6 lg:px-10">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Seller dashboard {q.data.merchant?.verified ? "· verified merchant" : "· verification pending"}</p>
          <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">{store.name}</h1>
          <a href={`/store/${store.slug}`} className="num text-[13px] text-sage hover:underline">/store/{store.slug}</a>
        </div>
        {q.data.stores.length > 1 && (
          <select className="field !w-auto" value={store.id} onChange={(e) => setStoreId(e.target.value)} aria-label="Store">
            {q.data.stores.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        )}
      </div>

      <nav className="mt-8 flex gap-1 overflow-x-auto border-b hairline" aria-label="Seller sections">
        {TABS.map(([k, label]) => (
          <button key={k} onClick={() => router.replace(`/sell?tab=${k}`, { scroll: false })} className={`relative shrink-0 px-4 py-3 text-[13.5px] transition-colors ${tab === k ? "text-porcelain" : "text-mist hover:text-porcelain"}`}>
            {label}
            {tab === k && <motion.span layoutId="sell-tab" className="absolute inset-x-2 -bottom-px h-px bg-champagne" />}
          </button>
        ))}
      </nav>

      <div className="mt-8">
        {tab === "overview" && <Overview store={store} />}
        {tab === "products" && <Products store={store} />}
        {tab === "orders" && <SellerOrders store={store} />}
        {tab === "offers" && <Offers store={store} />}
        {tab === "agent" && <SellerAgent store={store} />}
        {tab === "settings" && <StoreSettings store={store} onSaved={() => q.refetch()} />}
      </div>
    </div>
  );
}
