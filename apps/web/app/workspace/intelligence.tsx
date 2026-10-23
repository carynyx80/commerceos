"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { Bot, Check, Lock, Store } from "@/components/icons";

/** Shapes produced by agent-core's `absorb` from real tool results. */
export interface Intel {
  products: any[];
  comparison: { cheapest: string | null; items: any[] } | null;
  sellers: any[];
  negotiation: any | null;
  policy: { allowed: boolean; reasons: string[]; spentInWindow: Money; remainingInWindow: Money; maxPerOrder: Money; expiresAt: string | null } | null;
  checkout: any | null;
  orders: any[] | null;
}

type Money = { usd: number; display: string };

export function IntelligencePanel({ intel, working, autonomous }: { intel: Intel | null; working: boolean; autonomous: boolean }) {
  const empty = !intel || (!intel.products.length && !intel.comparison && !intel.sellers.length && !intel.negotiation && !intel.policy && !intel.checkout && !intel.orders);
  return (
    <div className="space-y-6 p-5">
      <div className="flex items-center justify-between">
        <p className="eyebrow">Live commerce intelligence</p>
        {working && <span className="flex items-center gap-1.5 text-[11px] text-champagne"><span className="size-1.5 animate-pulse rounded-full bg-champagne" /> updating</span>}
      </div>
      {empty ? (
        <p className="text-[13px] leading-relaxed text-dim">Matches, comparisons, seller records, offers, policy checks and checkout previews appear here as your agent works. Everything shown comes from tool results, not from the model.</p>
      ) : (
        <AnimatePresence mode="popLayout">
          {intel!.comparison && (
            <Card key="cmp" title="Price comparison">
              <ul className="space-y-1.5">
                {intel!.comparison.items.map((p: any) => (
                  <li key={p.productId} className="flex items-center justify-between gap-3 text-[12.5px]">
                    <Link href={`/product/${p.productId}`} className="min-w-0 truncate hover:text-champagne">{p.productId === intel!.comparison!.cheapest && <span className="mr-1 text-ok">●</span>}{p.title}</Link>
                    <span className="num shrink-0">{p.price.display}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
          {intel!.products.length > 0 && (
            <Card key="matches" title={`Product matches · ${intel!.products.length}`}>
              <ul className="space-y-2">
                {intel!.products.slice(0, 6).map((p: any) => (
                  <motion.li layout key={p.productId} className="rounded-xl border hairline p-3">
                    <div className="flex items-start justify-between gap-3">
                      <Link href={`/product/${p.productId}`} className="text-[13px] font-medium hover:text-champagne">{p.title}</Link>
                      <span className="num shrink-0 text-[13px]">{p.price?.display}</span>
                    </div>
                    <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-mist">
                      <span className="flex items-center gap-1"><Store size={11} /> {p.store?.name}{p.store?.verified && <Check size={11} className="text-sage" />}</span>
                      <span className="num">{p.inStock} in stock</span>
                      {p.rating && <span className="num">{p.rating.average}★ ({p.rating.verifiedReviews})</span>}
                      {p.negotiable && <span className="text-champagne">negotiable</span>}
                      {p.demoListing && <span className="text-dim">demo</span>}
                    </p>
                  </motion.li>
                ))}
              </ul>
            </Card>
          )}
          {intel!.sellers.length > 0 && (
            <Card key="sellers" title="Seller ratings">
              {intel!.sellers.map((s: any) => (
                <div key={s.storeId} className="flex items-center justify-between py-1 text-[12.5px]">
                  <span>{s.name} {s.verifiedMerchant && <Check size={11} className="inline text-sage" />}</span>
                  <span className="num text-mist">{s.rating ? `${s.rating.average}★` : "no reviews"} · {s.settledOrders} settled</span>
                </div>
              ))}
            </Card>
          )}
          {intel!.negotiation && (
            <Card key="neg" title={`Negotiation · ${String(intel!.negotiation.status ?? "").toLowerCase()}`}>
              <ol className="space-y-1.5 text-[12.5px]">
                {(intel!.negotiation.offers ?? []).map((o: any) => (
                  <li key={`${o.from}-${o.expiresAt}`} className="flex justify-between"><span className={o.from === "SELLER" ? "text-sage" : ""}>{o.from === "SELLER" ? "Seller" : "You"} · {o.status?.toLowerCase()}</span><span className="num">{o.price?.display}</span></li>
                ))}
              </ol>
              {intel!.negotiation.agreedPrice && <p className="mt-2 text-[12.5px] text-ok">Agreed at {intel!.negotiation.agreedPrice.display}</p>}
            </Card>
          )}
          {intel!.policy && (
            <Card key="policy" title="Spending policy">
              <p className={`flex items-center gap-1.5 text-[13px] ${intel!.policy.allowed ? "text-ok" : "text-warn"}`}>{intel!.policy.allowed ? <Check size={13} /> : <Lock size={13} />}{intel!.policy.allowed ? "Within your limits" : "Needs your approval"}</p>
              {intel!.policy.reasons?.map((r) => <p key={r} className="mt-1 text-[12px] text-mist">· {r}</p>)}
              <div className="mt-2 grid grid-cols-2 gap-2 text-[11.5px]">
                <div><p className="text-dim">Per order</p><p className="num">{intel!.policy.maxPerOrder?.display}</p></div>
                <div><p className="text-dim">Remaining in window</p><p className="num">{intel!.policy.remainingInWindow?.display}</p></div>
              </div>
            </Card>
          )}
          {intel!.checkout && (
            <Card key="checkout" title="Checkout preview">
              {intel!.checkout.error ? (
                <p className="text-[12.5px] text-danger">{intel!.checkout.message}</p>
              ) : intel!.checkout.mode === "USER_APPROVAL_REQUIRED" ? (
                <>
                  <p className="text-[13px]">{intel!.checkout.total?.display} · you approve in checkout</p>
                  <p className="mt-1 text-[12px] text-mist">{intel!.checkout.reason}</p>
                  <Link href={intel!.checkout.checkoutLink} className="btn btn-primary btn-sm mt-3">Review and pay</Link>
                </>
              ) : (
                <>
                  <p className="flex items-center gap-1.5 text-[13px]"><Bot size={13} className="text-champagne" /> {intel!.checkout.total?.display} payable by your agent account</p>
                  {intel!.checkout.execution && <p className="mt-1 text-[12.5px] text-mist">State: {intel!.checkout.execution.state ?? intel!.checkout.execution.error}</p>}
                  {intel!.checkout.orderId && <Link href={`/orders/${intel!.checkout.orderId}`} className="btn btn-secondary btn-sm mt-3">View order</Link>}
                </>
              )}
            </Card>
          )}
          {intel!.orders && (
            <Card key="orders" title="Orders">
              {intel!.orders.map((o: any) => (
                <Link key={o.orderId} href={`/orders/${o.orderId}`} className="flex justify-between py-1 text-[12.5px] hover:text-champagne"><span className="truncate">{o.product}</span><span className="num shrink-0 text-mist">{o.state.toLowerCase()}</span></Link>
              ))}
            </Card>
          )}
        </AnimatePresence>
      )}
      <p className="border-t hairline pt-4 text-[11.5px] text-dim">Autonomous payments: {autonomous ? "available for agents with a linked smart account and enabled automation." : "not available on this deployment; agents prepare checkouts for you to pay."}</p>
    </div>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <motion.section layout initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }} className="surface rounded-2xl p-4">
      <p className="eyebrow mb-3">{title}</p>
      {children}
    </motion.section>
  );
}
