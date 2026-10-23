"use client";
import { useState } from "react";
import { useAccount } from "wagmi";
import { useQueryClient } from "@tanstack/react-query";
import { Store } from "@/components/icons";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";

export function Onboarding({ onCreated }: { onCreated: (id: string) => void }) {
  const { address } = useAccount();
  const toast = useToast();
  const qc = useQueryClient();
  const [f, setF] = useState({ name: "", slug: "", tagline: "", description: "", payoutAddress: address ?? "", returnPolicy: "" });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setF((x) => ({ ...x, [k]: e.target.value, ...(k === "name" && !x.slug ? {} : {}) }));

  return (
    <div className="mx-auto grid max-w-[1100px] gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[1fr_1.2fr]">
      <div>
        <Store size={22} className="text-champagne" />
        <h1 className="display mt-6 text-[clamp(40px,5vw,60px)]">Open your storefront.</h1>
        <p className="mt-4 text-mist">Accept USDG and ETH through escrow. You are paid to your payout wallet when buyers confirm delivery, minus a 2% protocol fee.</p>
        <ul className="mt-8 space-y-3 text-[14px] text-porcelain/85">
          <li>1 · Create the store (this form)</li>
          <li>2 · Your payout wallet is registered on-chain automatically</li>
          <li>3 · Add products and, optionally, floor prices for your sales agent</li>
        </ul>
      </div>
      <form
        className="surface space-y-4 rounded-3xl p-6 sm:p-8"
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          try {
            const s = await api<{ id: string }>("/merchant/stores", { json: f });
            await qc.invalidateQueries({ queryKey: ["me"] });
            toast({ title: "Store created", body: "Registering your payout wallet on-chain…", tone: "ok" });
            onCreated(s.id);
          } catch (err: any) {
            toast({ title: "Could not create store", body: err.message, tone: "error" });
          } finally {
            setBusy(false);
          }
        }}
      >
        <div>
          <label className="label" htmlFor="name">Store name</label>
          <input id="name" required className="field" value={f.name} onChange={(e) => setF((x) => ({ ...x, name: e.target.value, slug: x.slug || "" }))} onBlur={() => !f.slug && setF((x) => ({ ...x, slug: x.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") }))} />
        </div>
        <div>
          <label className="label" htmlFor="slug">Store address</label>
          <div className="flex items-center gap-2"><span className="num text-[13px] text-dim">/store/</span><input id="slug" required className="field num" value={f.slug} onChange={set("slug")} pattern="[a-z0-9]+(-[a-z0-9]+)*" /></div>
        </div>
        <div><label className="label" htmlFor="tagline">Tagline</label><input id="tagline" className="field" value={f.tagline} onChange={set("tagline")} maxLength={140} /></div>
        <div><label className="label" htmlFor="desc">About the store</label><textarea id="desc" rows={3} className="field" value={f.description} onChange={set("description")} /></div>
        <div>
          <label className="label" htmlFor="payout">Payout wallet</label>
          <input id="payout" required className="field num" value={f.payoutAddress} onChange={set("payoutAddress")} placeholder="0x…" />
          <p className="mt-1 text-[11.5px] text-dim">Settlements are sent here. It must be a wallet you control.</p>
        </div>
        <div><label className="label" htmlFor="policy">Return policy</label><textarea id="policy" rows={2} className="field" value={f.returnPolicy} onChange={set("returnPolicy")} /></div>
        <button className="btn btn-primary w-full" disabled={busy}>{busy ? "Creating…" : "Create storefront"}</button>
      </form>
    </div>
  );
}
