"use client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ProductCard } from "@/components/product-card";
import { Close, Search } from "@/components/icons";
import { api } from "@/lib/api";
import type { ProductCard as P } from "@/lib/types";

const SORTS = [
  ["relevance", "Relevance"],
  ["newest", "Recently listed"],
  ["price_asc", "Price: low to high"],
  ["price_desc", "Price: high to low"],
] as const;

export default function ExplorePage() {
  return (
    <Suspense>
      <Explore />
    </Suspense>
  );
}

function Explore() {
  const sp = useSearchParams();
  const router = useRouter();
  const [q, setQ] = useState(sp.get("q") ?? "");
  const [filtersOpen, setFiltersOpen] = useState(false);
  useEffect(() => setQ(sp.get("q") ?? ""), [sp]);

  const params = new URLSearchParams(sp.toString());
  params.delete("cursor");
  const key = params.toString();

  const set = (k: string, v: string | null) => {
    const n = new URLSearchParams(sp.toString());
    if (v === null || v === "") n.delete(k);
    else n.set(k, v);
    router.replace(`/explore?${n.toString()}`, { scroll: false });
  };

  const cats = useQuery({ queryKey: ["categories"], queryFn: () => api<{ name: string; count: number }[]>("/catalog/categories") });
  const stores = useQuery({ queryKey: ["stores-all"], queryFn: () => api<{ items: { slug: string; name: string }[] }>("/stores/trending") });

  const results = useInfiniteQuery({
    queryKey: ["search", key],
    initialPageParam: "",
    queryFn: ({ pageParam }) => api<{ items: P[]; total: number; nextCursor: string | null }>(`/catalog/search?${key}${pageParam ? `&cursor=${pageParam}` : ""}&limit=12`),
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const total = results.data?.pages[0]?.total;

  const active = ["category", "store", "minPrice", "maxPrice", "asset", "negotiable", "inStock"].filter((k) => sp.get(k));

  const Filters = (
    <div className="space-y-8">
      <FilterGroup title="Category">
        <Radio label="All categories" checked={!sp.get("category")} onClick={() => set("category", null)} />
        {cats.data?.map((c) => (
          <Radio key={c.name} label={c.name} count={c.count} checked={sp.get("category") === c.name} onClick={() => set("category", c.name)} />
        ))}
      </FilterGroup>
      <FilterGroup title="Price (USD)">
        <div className="flex items-center gap-2">
          <PriceInput placeholder="Min" value={sp.get("minPrice")} onCommit={(v) => set("minPrice", v)} />
          <span className="text-dim">–</span>
          <PriceInput placeholder="Max" value={sp.get("maxPrice")} onCommit={(v) => set("maxPrice", v)} />
        </div>
      </FilterGroup>
      <FilterGroup title="Seller">
        <select className="field" value={sp.get("store") ?? ""} onChange={(e) => set("store", e.target.value)}>
          <option value="">All sellers</option>
          {stores.data?.items.map((s) => <option key={s.slug} value={s.slug}>{s.name}</option>)}
        </select>
      </FilterGroup>
      <FilterGroup title="Payment">
        <Radio label="Any asset" checked={!sp.get("asset")} onClick={() => set("asset", null)} />
        <Radio label="USDG" checked={sp.get("asset") === "USDG"} onClick={() => set("asset", "USDG")} />
        <Radio label="ETH" checked={sp.get("asset") === "ETH"} onClick={() => set("asset", "ETH")} />
      </FilterGroup>
      <FilterGroup title="Availability">
        <Toggle label="In stock only" on={sp.get("inStock") === "true"} onClick={() => set("inStock", sp.get("inStock") === "true" ? null : "true")} />
        <Toggle label="AI negotiation available" on={sp.get("negotiable") === "true"} onClick={() => set("negotiable", sp.get("negotiable") === "true" ? null : "true")} />
      </FilterGroup>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1440px] px-4 pb-10 pt-10 sm:px-6 lg:px-10 lg:pt-14">
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <p className="eyebrow">Marketplace</p>
          <h1 className="display mt-3 text-[clamp(44px,5.5vw,76px)]">Explore</h1>
        </div>
        <form
          className="surface flex w-full max-w-md items-center gap-3 rounded-full px-4"
          onSubmit={(e) => {
            e.preventDefault();
            set("q", q.trim());
          }}
        >
          <Search size={16} className="text-mist" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search products, stores, categories" className="h-11 flex-1 bg-transparent text-[14px] outline-none placeholder:text-dim" aria-label="Search" />
          {q && <button type="button" onClick={() => { setQ(""); set("q", null); }} aria-label="Clear search" className="text-dim hover:text-porcelain"><Close size={14} /></button>}
        </form>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[230px_1fr]">
        <aside className="hidden lg:block">{Filters}</aside>
        <section>
          <div className="mb-6 flex flex-wrap items-center justify-between gap-3 border-b hairline pb-4">
            <p className="text-[13px] text-mist">
              {results.isLoading ? "Searching…" : results.isError ? "" : <><span className="num text-porcelain">{total ?? 0}</span> {total === 1 ? "result" : "results"}{sp.get("q") && <> for “{sp.get("q")}”</>}</>}
            </p>
            <div className="flex items-center gap-2">
              <button className="btn btn-secondary btn-sm lg:hidden" onClick={() => setFiltersOpen(true)}>Filters{active.length ? ` · ${active.length}` : ""}</button>
              <select className="field !h-8 !w-auto !rounded-full !py-0 text-[13px]" value={sp.get("sort") ?? "relevance"} onChange={(e) => set("sort", e.target.value)} aria-label="Sort">
                {SORTS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
              </select>
            </div>
          </div>

          {results.isError ? (
            <div className="surface rounded-2xl px-6 py-16 text-center text-mist">The marketplace API is unreachable. Try again shortly.</div>
          ) : results.isLoading ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4">
              {Array.from({ length: 8 }).map((_, i) => (
                <div key={i}><div className="aspect-[4/5] animate-pulse rounded-2xl bg-porcelain/[0.04]" /><div className="mt-3 h-3 w-2/3 animate-pulse rounded bg-porcelain/[0.05]" /></div>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="surface rounded-2xl px-6 py-16 text-center">
              <p className="display text-[28px]">Nothing matches yet.</p>
              <p className="mt-2 text-mist">Try a broader search, or ask an agent to watch for it.</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4 lg:gap-x-6">
              {items.map((p, i) => <ProductCard key={p.id} p={p} index={i % 12} priority={i < 4} />)}
            </div>
          )}

          {results.hasNextPage && (
            <div className="mt-12 text-center">
              <button className="btn btn-secondary" onClick={() => results.fetchNextPage()} disabled={results.isFetchingNextPage}>
                {results.isFetchingNextPage ? "Loading…" : "Load more"}
              </button>
            </div>
          )}
        </section>
      </div>

      <AnimatePresence>
        {filtersOpen && (
          <motion.div className="fixed inset-0 z-50 lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="absolute inset-0 bg-black/50" onClick={() => setFiltersOpen(false)} />
            <motion.div initial={{ y: "100%" }} animate={{ y: 0 }} exit={{ y: "100%" }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-3xl border-t hairline bg-obsidian-2 p-6">
              <div className="mb-6 flex items-center justify-between">
                <p className="display text-[26px]">Filters</p>
                <button className="btn btn-ghost btn-sm" onClick={() => setFiltersOpen(false)}>Done</button>
              </div>
              {Filters}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow mb-3">{title}</p>
      <div className="space-y-1">{children}</div>
    </div>
  );
}
function Radio({ label, count, checked, onClick }: { label: string; count?: number; checked: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[13.5px] transition-colors ${checked ? "bg-evergreen/60 text-porcelain" : "text-mist hover:text-porcelain"}`} aria-pressed={checked}>
      {label}
      {count !== undefined && <span className="num text-[11px] text-dim">{count}</span>}
    </button>
  );
}
function Toggle({ label, on, onClick }: { label: string; on: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-[13.5px] text-mist hover:text-porcelain" role="switch" aria-checked={on}>
      {label}
      <span className={`relative h-4 w-7 rounded-full transition-colors ${on ? "bg-champagne" : "bg-porcelain/15"}`}>
        <span className={`absolute top-0.5 size-3 rounded-full bg-obsidian transition-all ${on ? "left-3.5" : "left-0.5"}`} />
      </span>
    </button>
  );
}
function PriceInput({ value, placeholder, onCommit }: { value: string | null; placeholder: string; onCommit: (v: string | null) => void }) {
  const [v, setV] = useState(value ? String(Number(value) / 100) : "");
  useEffect(() => setV(value ? String(Number(value) / 100) : ""), [value]);
  return (
    <input
      inputMode="numeric"
      className="field num !h-9 text-[13px]"
      placeholder={placeholder}
      value={v}
      onChange={(e) => setV(e.target.value.replace(/[^0-9]/g, ""))}
      onBlur={() => onCommit(v ? String(Number(v) * 100) : null)}
      onKeyDown={(e) => e.key === "Enter" && onCommit(v ? String(Number(v) * 100) : null)}
      aria-label={`${placeholder} price`}
    />
  );
}
