import Link from "next/link";
import { formatUsd } from "@commerce-os/shared";
import { HeroDemo } from "@/components/landing/hero-demo";
import { ProductCard } from "@/components/product-card";
import { Reveal } from "@/components/reveal";
import { Arrow, Bot, Lock, Pulse, Shield, Store } from "@/components/icons";
import { serverApi } from "@/lib/api";
import type { ProductCard as P, StoreSummary } from "@/lib/types";

interface Stats {
  products: number;
  stores: number;
  ordersSettled: number;
  settledVolumeCents: number;
  activeAgents: number;
  fixtureOnly: boolean;
}

async function load() {
  try {
    const [featured, stores, stats] = await Promise.all([
      serverApi<{ items: P[] }>("/catalog/featured"),
      serverApi<{ items: (StoreSummary & { productCount: number })[] }>("/stores/trending"),
      serverApi<Stats>("/stats"),
    ]);
    return { featured: featured.items, stores: stores.items, stats, down: false };
  } catch {
    return { featured: [] as P[], stores: [] as (StoreSummary & { productCount: number })[], stats: null, down: true };
  }
}

export const dynamic = "force-dynamic";

export default async function Home() {
  const { featured, stores, stats, down } = await load();

  return (
    <>
      {/* HERO */}
      <section className="relative overflow-hidden">
        <div className="mx-auto grid max-w-[1440px] items-center gap-14 px-4 pb-20 pt-14 sm:px-6 lg:grid-cols-[1fr_1.05fr] lg:gap-16 lg:px-10 lg:pb-28 lg:pt-24">
          <div>
            <Reveal>
              <p className="eyebrow flex items-center gap-2"><span className="h-px w-6 bg-sage/60" /> The operating system for autonomous commerce</p>
            </Reveal>
            <Reveal delay={0.06}>
              <h1 className="display mt-6 text-[clamp(52px,7.4vw,112px)]">
                Commerce,<br />
                <em className="text-champagne">without</em> boundaries.
              </h1>
            </Reveal>
            <Reveal delay={0.12}>
              <p className="mt-7 max-w-[30rem] text-[17px] leading-relaxed text-mist">
                Buy, sell, and transact through intelligent AI agents. Discover products, negotiate better deals, and settle securely on-chain.
              </p>
            </Reveal>
            <Reveal delay={0.18}>
              <div className="mt-9 flex flex-wrap gap-3">
                <Link href="/explore" className="btn btn-primary h-12 px-6 text-[15px]">Explore Marketplace <Arrow size={16} /></Link>
                <Link href="/workspace" className="btn btn-secondary h-12 px-6 text-[15px]"><Bot size={16} /> Launch AI Agent</Link>
              </div>
            </Reveal>
            <Reveal delay={0.24}>
              <LiveStats stats={stats} down={down} />
            </Reveal>
          </div>
          <Reveal delay={0.1} y={24}>
            <HeroDemo />
          </Reveal>
        </div>
      </section>

      {/* FEATURED */}
      <Section eyebrow="Featured" title="Objects worth the attention" action={{ href: "/explore", label: "View all products" }}>
        {featured.length ? (
          <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4 lg:gap-x-6">
            {featured.slice(0, 8).map((p, i) => <ProductCard key={p.id} p={p} index={i} />)}
          </div>
        ) : (
          <Empty down={down} what="featured products" />
        )}
      </Section>

      {/* STORES */}
      <Section eyebrow="Storefronts" title="Trending stores" action={{ href: "/explore", label: "Browse all" }}>
        {stores.length ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {stores.slice(0, 4).map((s) => (
              <Link key={s.id} href={`/store/${s.slug}`} className="surface group rounded-2xl p-5 transition-colors hover:border-line-2">
                <div className="flex items-center gap-3">
                  <div className="grid size-11 place-items-center overflow-hidden rounded-full bg-evergreen text-champagne">
                    {s.logoUrl ? <img src={s.logoUrl} alt="" className="size-full object-cover" /> : <span className="display text-[20px]">{s.name[0]}</span>}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-medium group-hover:text-champagne">{s.name}</p>
                    <p className="num text-[11.5px] text-dim">{s.productCount} listings{s.isFixture ? " · demo store" : ""}</p>
                  </div>
                </div>
                <p className="mt-4 line-clamp-2 text-[13px] text-mist">{s.tagline}</p>
              </Link>
            ))}
          </div>
        ) : (
          <Empty down={down} what="stores" />
        )}
      </Section>

      {/* AI INTRO */}
      <section className="mx-auto mt-28 max-w-[1440px] px-4 sm:px-6 lg:px-10">
        <div className="surface-raised relative overflow-hidden rounded-[32px] px-6 py-14 sm:px-12 lg:px-16 lg:py-20">
          <div className="grid gap-12 lg:grid-cols-2">
            <div>
              <p className="eyebrow">AI-powered shopping</p>
              <h2 className="display mt-5 text-[clamp(38px,4.6vw,64px)]">Describe it. <br /><em className="text-champagne">Your agent</em> does the rest.</h2>
              <p className="mt-6 max-w-md text-mist">
                Tell your agent what you want in plain language. It searches live listings, checks seller history, compares prices and negotiates, only inside the limits you set.
              </p>
              <Link href="/workspace" className="btn btn-primary mt-8">Open the AI workspace <Arrow size={15} /></Link>
            </div>
            <ul className="grid gap-px overflow-hidden rounded-2xl border hairline bg-line sm:grid-cols-2">
              {[
                ["Grounded answers", "Every price, rating and stock count comes from the marketplace database, never the model's imagination."],
                ["Structured negotiation", "Offers carry a terms hash, expiry and quantity. Seller agents answer within merchant-set floors."],
                ["Spending policies", "Per-order caps, rolling limits, approved sellers and expiry. Enforced by contract, not by prompt."],
                ["Full audit trail", "Each tool call, offer and payment is logged so you can see exactly what your agent did."],
              ].map(([t, b]) => (
                <li key={t} className="bg-obsidian-2 p-6">
                  <p className="font-medium">{t}</p>
                  <p className="mt-2 text-[13.5px] text-mist">{b}</p>
                </li>
              ))}
            </ul>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <Section id="how" eyebrow="How autonomous purchasing works" title="Five steps, each one verifiable">
        <ol className="grid gap-px overflow-hidden rounded-2xl border hairline bg-line md:grid-cols-5">
          {[
            ["Set the policy", "Choose spending caps, assets, approved stores and an expiry. You sign it once."],
            ["Brief your agent", "Ask for what you need. The agent searches real listings with structured tools."],
            ["Negotiate", "Agents exchange signed, time-limited offers. Sellers answer inside their own floors."],
            ["Quote & check", "An accepted offer becomes a server-signed quote. Policy limits are checked on-chain."],
            ["Escrow settles", "Funds lock in escrow until delivery is confirmed. 98% to the seller, 2% protocol fee."],
          ].map(([t, b], i) => (
            <li key={t} className="bg-obsidian-2 p-6">
              <span className="num text-[12px] text-champagne">0{i + 1}</span>
              <p className="mt-6 font-medium">{t}</p>
              <p className="mt-2 text-[13.5px] text-mist">{b}</p>
            </li>
          ))}
        </ol>
      </Section>

      {/* ESCROW */}
      <Section id="escrow" eyebrow="Escrow protection" title="Paid on delivery, enforced by code">
        <div className="grid gap-6 lg:grid-cols-[1.1fr_1fr]">
          <div className="surface rounded-2xl p-6 sm:p-8">
            <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
              {["Funded", "Accepted", "Fulfilled", "Released"].map((s, i) => (
                <span key={s} className="flex items-center gap-2">
                  <span className={`chip ${i === 3 ? "!border-champagne/40 !text-champagne" : ""}`}>{s}</span>
                  {i < 3 && <span className="text-dim">→</span>}
                </span>
              ))}
            </div>
            <p className="mt-6 text-mist">
              Your payment is held by the CommerceEscrow contract, not by Commerce OS or the seller. Sellers are paid when you confirm delivery or the agreed confirmation window passes. If a seller cancels or fails to fulfil, the same asset returns to you.
            </p>
            <div className="mt-6 grid grid-cols-3 gap-4 border-t hairline pt-6">
              <Mini k="Order" v="100.00 USDG" />
              <Mini k="Seller receives" v="98.00 USDG" />
              <Mini k="Protocol fee" v="2.00 USDG" />
            </div>
          </div>
          <ul className="space-y-3">
            {[
              [Shield, "Disputes keep funds locked", "Evidence is collected off-chain; an independent arbiter decides the split on-chain."],
              [Lock, "No admin can withdraw escrow", "Escrowed funds move only to the buyer or seller of that order."],
              [Pulse, "Order states from confirmed events", "We never mark an order paid because a transaction was sent, only when it is confirmed."],
            ].map(([Icon, t, b]: any) => (
              <li key={t} className="surface flex gap-4 rounded-2xl p-5">
                <Icon size={18} className="mt-0.5 shrink-0 text-sage" />
                <div>
                  <p className="font-medium">{t}</p>
                  <p className="mt-1 text-[13.5px] text-mist">{b}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* MERCHANTS + AGENTS */}
      <section className="mx-auto mt-28 grid max-w-[1440px] gap-6 px-4 sm:px-6 lg:grid-cols-2 lg:px-10">
        <div className="surface rounded-[28px] p-8 sm:p-10">
          <Store size={20} className="text-champagne" />
          <h3 className="display mt-6 text-[40px]">Open a storefront in minutes.</h3>
          <p className="mt-4 max-w-md text-mist">List products, accept USDG and ETH, and let your own seller agent answer questions and negotiate within the floors you set.</p>
          <ul className="mt-6 space-y-2 text-[14px] text-porcelain/85">
            <li>· Public store at <span className="num text-sage">/store/your-name</span></li>
            <li>· Settlements straight to your payout wallet</li>
            <li>· Real analytics from confirmed orders only</li>
          </ul>
          <Link href="/sell" className="btn btn-secondary mt-8">Start selling <Arrow size={15} /></Link>
        </div>
        <div className="surface rounded-[28px] p-8 sm:p-10">
          <Bot size={20} className="text-champagne" />
          <h3 className="display mt-6 text-[40px]">Agents with boundaries.</h3>
          <div className="mt-6 grid grid-cols-2 gap-3 text-[13.5px]">
            {["Product discovery", "Price comparison", "Seller evaluation", "Offer negotiation", "Authorised purchasing", "Order tracking", "Customer Q&A", "Permitted discounts"].map((c) => (
              <div key={c} className="rounded-xl border hairline px-3 py-2.5 text-porcelain/85">{c}</div>
            ))}
          </div>
          <Link href="/agents" className="btn btn-secondary mt-8">Open Agent Studio <Arrow size={15} /></Link>
        </div>
      </section>

      {/* PAYMENTS + DEV */}
      <section className="mx-auto mt-6 grid max-w-[1440px] gap-6 px-4 sm:px-6 lg:grid-cols-[1fr_1.4fr] lg:px-10">
        <div className="surface rounded-[28px] p-8 sm:p-10">
          <p className="eyebrow">Supported payments</p>
          <div className="mt-6 space-y-3">
            <Asset sym="USDG" name="Global Dollar" note="ERC-20 · 6 decimals · approve + pay" />
            <Asset sym="ETH" name="Ether" note="Native · priced from a validated oracle quote" />
          </div>
          <p className="mt-6 text-[12.5px] text-dim">Prices are listed in USD. Quotes lock the asset amount for a short window and expire rather than drift.</p>
        </div>
        <div className="surface overflow-hidden rounded-[28px]">
          <div className="flex items-center justify-between border-b hairline px-6 py-4">
            <p className="eyebrow">Developer infrastructure</p>
            <Link href="/developers" className="text-[13px] text-mist hover:text-porcelain">API reference →</Link>
          </div>
          <pre className="num overflow-x-auto p-6 text-[12.5px] leading-relaxed text-porcelain/85">
{`// Ask the marketplace like an agent does
const res = await fetch("/api/catalog/search?q=camera&maxPrice=125000");
const { items } = await res.json();

// Escrow on Robinhood Chain
escrow.payWithToken(order, quoteSignature);   // USDG
escrow.payWithEth{ value }(order, quoteSignature); // ETH
escrow.confirmDelivery(orderId);  // 98% seller · 2% treasury`}
          </pre>
        </div>
      </section>
    </>
  );
}

function LiveStats({ stats, down }: { stats: Stats | null; down: boolean }) {
  if (down || !stats)
    return <p className="mt-12 text-[12.5px] text-dim">Live marketplace figures appear here once the API is reachable.</p>;
  return (
    <div className="mt-14 border-t hairline pt-6">
      <dl className="grid max-w-lg grid-cols-3 gap-6">
        <Mini k="Live listings" v={stats.products.toLocaleString()} />
        <Mini k="Storefronts" v={stats.stores.toLocaleString()} />
        <Mini k="Settled volume" v={formatUsd(stats.settledVolumeCents)} />
      </dl>
      <p className="mt-3 text-[11.5px] text-dim">
        Counted from the marketplace database{stats.fixtureOnly ? " · currently development fixtures only" : ""}.
      </p>
    </div>
  );
}

function Mini({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <dt className="text-[12px] text-dim">{k}</dt>
      <dd className="num mt-1 text-[17px]">{v}</dd>
    </div>
  );
}

function Asset({ sym, name, note }: { sym: string; name: string; note: string }) {
  return (
    <div className="flex items-center gap-4 rounded-2xl border hairline p-4">
      <div className="num grid size-11 place-items-center rounded-full bg-evergreen text-[12px] text-champagne">{sym}</div>
      <div>
        <p className="font-medium">{name}</p>
        <p className="text-[12.5px] text-mist">{note}</p>
      </div>
    </div>
  );
}

function Section({ id, eyebrow, title, action, children }: { id?: string; eyebrow: string; title: string; action?: { href: string; label: string }; children: React.ReactNode }) {
  return (
    <section id={id} className="mx-auto mt-28 max-w-[1440px] scroll-mt-24 px-4 sm:px-6 lg:px-10">
      <div className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="eyebrow">{eyebrow}</p>
          <h2 className="display mt-4 text-[clamp(34px,4vw,56px)]">{title}</h2>
        </div>
        {action && <Link href={action.href} className="btn btn-ghost">{action.label} <Arrow size={14} /></Link>}
      </div>
      {children}
    </section>
  );
}

function Empty({ down, what }: { down: boolean; what: string }) {
  return (
    <div className="surface rounded-2xl px-6 py-14 text-center text-mist">
      {down ? `The marketplace API is not reachable, so ${what} can't be shown right now.` : `No ${what} yet.`}
    </div>
  );
}
