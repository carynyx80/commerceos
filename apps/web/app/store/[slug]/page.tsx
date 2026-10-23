import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { formatUsd } from "@commerce-os/shared";
import { ProductCard } from "@/components/product-card";
import { Check } from "@/components/icons";
import { ApiError, serverApi } from "@/lib/api";
import { shortAddr, timeAgo } from "@/lib/format";
import type { ProductCard as P, StoreSummary } from "@/lib/types";

interface StorePage extends StoreSummary {
  description: string;
  returnPolicy: string;
  payoutAddress: string;
  createdAt: string;
  settledOrders: number;
  rating: { average: number; count: number } | null;
  products: P[];
  reviews: { id: string; rating: number; body: string; createdAt: string; product: string }[];
}

async function get(slug: string) {
  try {
    return await serverApi<StorePage>(`/stores/${encodeURIComponent(slug)}`);
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) return null;
    throw e;
  }
}

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const s = await get((await params).slug).catch(() => null);
  return { title: s?.name ?? "Store" };
}

export default async function Store({ params }: { params: Promise<{ slug: string }> }) {
  const s = await get((await params).slug);
  if (!s) notFound();
  return (
    <div>
      <div className="relative h-56 overflow-hidden border-b hairline sm:h-72">
        {s.bannerUrl ? (
          <img src={s.bannerUrl} alt="" className="size-full object-cover opacity-70" />
        ) : (
          <div className="size-full bg-[radial-gradient(800px_300px_at_20%_120%,rgba(198,169,120,0.18),transparent),linear-gradient(180deg,#203A32,#101817)]" />
        )}
      </div>
      <div className="mx-auto max-w-[1440px] px-4 sm:px-6 lg:px-10">
        <div className="-mt-12 flex flex-wrap items-end justify-between gap-6">
          <div className="flex items-end gap-5">
            <div className="display grid size-24 place-items-center overflow-hidden rounded-3xl border hairline bg-evergreen text-[40px] text-champagne shadow-2xl">
              {s.logoUrl ? <img src={s.logoUrl} alt="" className="size-full object-cover" /> : s.name[0]}
            </div>
            <div className="pb-1">
              <h1 className="display text-[clamp(36px,4.5vw,60px)]">{s.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12.5px] text-mist">
                {s.verified && <span className="chip !text-sage"><Check size={11} /> Verified merchant</span>}
                {s.isFixture && <span className="chip">Demo store · development fixture</span>}
                <span>Since {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", year: "numeric" })}</span>
              </div>
            </div>
          </div>
          <dl className="flex gap-8 pb-2">
            <Stat k="Listings" v={String(s.products.length)} />
            <Stat k="Settled orders" v={String(s.settledOrders)} />
            <Stat k="Rating" v={s.rating ? `${s.rating.average.toFixed(1)}★ (${s.rating.count})` : "—"} />
          </dl>
        </div>
        <p className="mt-8 max-w-2xl text-[16px] text-mist">{s.tagline}</p>

        <div className="mt-14 grid gap-12 lg:grid-cols-[1fr_300px]">
          <section>
            <h2 className="eyebrow mb-6">Products</h2>
            {s.products.length ? (
              <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3">
                {s.products.map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
              </div>
            ) : (
              <p className="text-mist">No active listings.</p>
            )}
          </section>
          <aside className="space-y-8 text-[14px]">
            <div><h3 className="eyebrow mb-3">About</h3><p className="text-porcelain/85">{s.description || "—"}</p></div>
            <div><h3 className="eyebrow mb-3">Store policy</h3><p className="text-porcelain/85">{s.returnPolicy || "No policy published."}</p></div>
            <div><h3 className="eyebrow mb-3">Settlement wallet</h3><p className="num text-mist">{shortAddr(s.payoutAddress)}</p></div>
            <div>
              <h3 className="eyebrow mb-3">Verified reviews</h3>
              {s.reviews.length === 0 ? <p className="text-mist">No reviews yet. Reviews come only from settled orders.</p> : (
                <ul className="space-y-4">
                  {s.reviews.map((r) => (
                    <li key={r.id}><p className="num text-[12px] text-champagne">{"★".repeat(r.rating)}</p><p className="mt-1">{r.body}</p><p className="mt-1 text-[12px] text-dim">{r.product} · {timeAgo(r.createdAt)}</p></li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function Stat({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[11.5px] text-dim">{k}</dt>
      <dd className="num mt-0.5 text-[16px]">{v}</dd>
    </div>
  );
}
