"use client";
import { useState } from "react";
import { ImageUpload } from "@/components/image-upload";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { MyStore } from "./page";

export function StoreSettings({ store, onSaved }: { store: MyStore; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: store.name, tagline: store.tagline, description: store.description, payoutAddress: store.payoutAddress, returnPolicy: store.returnPolicy, logoUrl: store.logoUrl, bannerUrl: store.bannerUrl });
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <form
      className="grid max-w-3xl gap-4"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        try {
          await api(`/merchant/stores/${store.id}`, { method: "PATCH", json: f });
          toast({ title: "Store saved", body: f.payoutAddress !== store.payoutAddress ? "New payout wallet is being registered on-chain." : undefined, tone: "ok" });
          onSaved();
        } catch (err: any) {
          toast({ title: "Could not save", body: err.message, tone: "error" });
        } finally {
          setBusy(false);
        }
      }}
    >
      <div className="flex flex-wrap items-center gap-4">
        <div className="display grid size-16 place-items-center overflow-hidden rounded-2xl bg-evergreen text-[26px] text-champagne">{f.logoUrl ? <img src={f.logoUrl} alt="" className="size-full object-cover" /> : f.name[0]}</div>
        <ImageUpload label="Upload logo" onUploaded={(url) => setF((x) => ({ ...x, logoUrl: url }))} />
        <ImageUpload label="Upload banner" onUploaded={(url) => setF((x) => ({ ...x, bannerUrl: url }))} />
        {f.bannerUrl && <span className="text-[12px] text-sage">Banner set</span>}
      </div>
      <div><label className="label">Name</label><input className="field" value={f.name} onChange={set("name")} /></div>
      <div><label className="label">Tagline</label><input className="field" value={f.tagline} onChange={set("tagline")} /></div>
      <div><label className="label">About</label><textarea className="field" rows={3} value={f.description} onChange={set("description")} /></div>
      <div>
        <label className="label">Payout wallet</label>
        <input className="field num" value={f.payoutAddress} onChange={set("payoutAddress")} />
        <p className="mt-1 text-[11.5px] text-dim">Changing it re-registers the store in the on-chain MerchantRegistry. Orders already in escrow pay the wallet recorded when they were funded.</p>
      </div>
      <div><label className="label">Return policy</label><textarea className="field" rows={3} value={f.returnPolicy} onChange={set("returnPolicy")} /></div>
      <div><button className="btn btn-primary" disabled={busy}>{busy ? "Saving…" : "Save store"}</button></div>
    </form>
  );
}
