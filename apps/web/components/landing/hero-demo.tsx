"use client";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useEffect, useState } from "react";
import { Bot, Check, Lock, Search, Store } from "../icons";

/**
 * Illustrative walkthrough of an agent purchase. It is a scripted animation, not live
 * data, and says so on screen.
 */
const STEPS = [
  { key: "ask", label: "Buyer request" },
  { key: "search", label: "Discovering listings" },
  { key: "sellers", label: "Seller agents respond" },
  { key: "negotiate", label: "Negotiating" },
  { key: "order", label: "Preparing order" },
  { key: "escrow", label: "Escrow confirmed" },
] as const;

const LISTINGS = [
  { name: "Leica Q2 — 28mm, boxed", store: "Atelier Optics", price: 1240, rating: 4.9 },
  { name: "Leica Q2 Reporter", store: "Northlight Supply", price: 1310, rating: 4.7 },
  { name: "Leica Q2 — body only", store: "Fieldwork Camera Co.", price: 1195, rating: 4.4 },
];

export function HeroDemo() {
  const reduce = useReducedMotion();
  const [step, setStep] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    if (paused) return;
    const t = setTimeout(() => setStep((s) => (s + 1) % STEPS.length), step === STEPS.length - 1 ? 4200 : 2600);
    return () => clearTimeout(t);
  }, [step, paused]);

  return (
    <div
      className="surface-raised grain relative overflow-hidden rounded-[28px] p-1.5"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
    >
      <div className="relative rounded-[22px] bg-obsidian/70">
        {/* window chrome */}
        <div className="flex items-center justify-between border-b hairline px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2 rounded-full bg-porcelain/15" />
            <span className="size-2 rounded-full bg-porcelain/15" />
            <span className="size-2 rounded-full bg-porcelain/15" />
          </div>
          <span className="chip !h-5 !border-champagne/30 !text-[10.5px] !text-champagne">Illustrative demo · not live data</span>
        </div>

        <div className="grid gap-0 md:grid-cols-[200px_1fr]">
          {/* step rail */}
          <ol className="hidden border-r hairline p-4 md:block">
            {STEPS.map((s, i) => (
              <li key={s.key}>
                <button
                  onClick={() => setStep(i)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left text-[12.5px] transition-colors ${i === step ? "text-porcelain" : i < step ? "text-sage" : "text-dim"}`}
                >
                  <span className={`grid size-5 shrink-0 place-items-center rounded-full border text-[10px] num ${i === step ? "border-champagne text-champagne" : i < step ? "border-sage/50" : "hairline"}`}>
                    {i < step ? <Check size={11} /> : i + 1}
                  </span>
                  {s.label}
                </button>
              </li>
            ))}
          </ol>

          <div className="relative min-h-[380px] p-5 sm:p-6">
            <div className="mb-5 flex items-start gap-3">
              <div className="grid size-8 shrink-0 place-items-center rounded-full bg-porcelain/10 text-[12px]">You</div>
              <p className="rounded-2xl rounded-tl-sm bg-porcelain/[0.06] px-4 py-2.5 text-[14px]">
                Find a Leica Q2 under $1,250 from a seller rated 4.5 or better.
              </p>
            </div>

            <AnimatePresence mode="wait">
              <motion.div
                key={step}
                initial={reduce ? false : { opacity: 0, y: 10, filter: "blur(4px)" }}
                animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
                exit={reduce ? undefined : { opacity: 0, y: -6 }}
                transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
              >
                <AgentLine step={step} />
                <StepBody step={step} />
              </motion.div>
            </AnimatePresence>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentLine({ step }: { step: number }) {
  const text = [
    "Understood. Setting a ceiling of $1,250 and a 4.5★ seller minimum.",
    "Searching listings in Cameras…",
    "Three seller agents answered. Fieldwork is below your rating bar.",
    "Asking Atelier Optics for $1,180.",
    "Atelier countered at $1,210. Within your limits. Preparing the order.",
    "Payment locked in escrow. The seller is paid when you confirm delivery.",
  ][step];
  return (
    <div className="mb-4 flex items-start gap-3">
      <div className="grid size-8 shrink-0 place-items-center rounded-full bg-evergreen text-champagne"><Bot size={15} /></div>
      <p className="pt-1.5 text-[14px] text-porcelain/90">{text}</p>
    </div>
  );
}

function StepBody({ step }: { step: number }) {
  if (step <= 1)
    return (
      <div className="ml-11 space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="flex items-center gap-3 rounded-xl border hairline px-3 py-3">
            <Search size={14} className="text-sage" />
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-porcelain/5">
              <motion.div className="h-full bg-sage/40" initial={{ width: "0%" }} animate={{ width: step === 1 ? "100%" : "20%" }} transition={{ duration: 1.8, delay: i * 0.25 }} />
            </div>
          </div>
        ))}
      </div>
    );
  if (step === 2)
    return (
      <div className="ml-11 space-y-2">
        {LISTINGS.map((l, i) => (
          <motion.div
            key={l.name}
            initial={{ opacity: 0, x: 8 }}
            animate={{ opacity: l.rating < 4.5 ? 0.45 : 1, x: 0 }}
            transition={{ delay: i * 0.12 }}
            className="flex items-center justify-between gap-3 rounded-xl border hairline px-3 py-2.5"
          >
            <div className="min-w-0">
              <p className="truncate text-[13.5px]">{l.name}</p>
              <p className="text-[11.5px] text-mist"><Store size={11} className="mr-1 inline" />{l.store} · <span className="num">{l.rating}★</span></p>
            </div>
            <span className="num text-[14px]">${l.price.toLocaleString()}</span>
          </motion.div>
        ))}
      </div>
    );
  if (step === 3 || step === 4)
    return (
      <div className="ml-11 space-y-2">
        <OfferRow who="Your agent" price={1180} status="Offer" />
        {step === 4 && <OfferRow who="Atelier Optics agent" price={1210} status="Counter" seller />}
        {step === 4 && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }} className="flex items-center justify-between rounded-xl bg-evergreen/50 px-3 py-2.5 text-[12.5px]">
            <span className="text-sage">Policy check · max $1,250 per order</span>
            <span className="flex items-center gap-1 text-ok"><Check size={13} /> within limit</span>
          </motion.div>
        )}
      </div>
    );
  return (
    <div className="ml-11 rounded-2xl border border-champagne/25 bg-champagne/[0.04] p-4">
      <div className="flex items-center justify-between">
        <span className="flex items-center gap-2 text-[13px] text-champagne"><Lock size={14} /> Escrow funded</span>
        <span className="num text-[11px] text-dim">order 0x7c…e41a</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-3 text-[12px]">
        <Stat k="Paid" v="1,210.00 USDG" />
        <Stat k="Seller receives" v="1,185.80" />
        <Stat k="Protocol fee" v="24.20" />
      </div>
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-porcelain/5">
        <motion.div className="h-full bg-champagne" initial={{ width: "0%" }} animate={{ width: "100%" }} transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1] }} />
      </div>
    </div>
  );
}

const Stat = ({ k, v }: { k: string; v: string }) => (
  <div>
    <p className="text-dim">{k}</p>
    <p className="num mt-0.5">{v}</p>
  </div>
);

function OfferRow({ who, price, status, seller }: { who: string; price: number; status: string; seller?: boolean }) {
  return (
    <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className={`flex items-center justify-between rounded-xl border hairline px-3 py-2.5 ${seller ? "ml-6" : ""}`}>
      <div>
        <p className="text-[11.5px] text-mist">{who}</p>
        <p className="text-[13px]">{status}</p>
      </div>
      <span className="num text-[15px]">${price.toLocaleString()}</span>
    </motion.div>
  );
}
