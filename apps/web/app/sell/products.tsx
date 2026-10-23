"use client";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "motion/react";
import { useState } from "react";
import { NETWORK_LABEL, assetsOn, formatUsd, type PaymentAsset } from "@commerce-os/shared";
import { Close, Plus } from "@/components/icons";
import { ImageUpload } from "@/components/image-upload";
import { ProductImage } from "@/components/product-image";
import { useToast } from "@/components/toast";
import { api } from "@/lib/api";
import type { MyStore } from "./page";

interface Row {
  id: string;
  title: string;
  category: string;
  priceCents: number;
  floorPriceCents: number | null;
  images: string[];
  status: string;
  negotiable: boolean;
  acceptedAssets: PaymentAsset[];
  deliveryType: "PHYSICAL" | "DIGITAL";
  description: string;
  shippingInfo: string;
  specs: Record<string, string>;
  inventory: { available: number; reserved: number } | null;
}

export function Products({ store }: { store: MyStore }) {
  const q = useQuery({ queryKey: ["my-products", store.id], queryFn: () => api<{ items: Row[] }>(`/merchant/stores/${store.id}/products`) });
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  return (
    <div>
      <div className="mb-5 flex items-center justify-between">
        <p className="text-[13px] text-mist">{q.data?.items.length ?? 0} listings</p>
        <button className="btn btn-primary btn-sm" onClick={() => setEditing("new")}><Plus size={14} /> Add product</button>
      </div>
      {q.data?.items.length === 0 && <div className="surface rounded-2xl p-10 text-center text-mist">No products yet. Add your first listing.</div>}
      <ul className="divide-y divide-line border-y hairline">
        {q.data?.items.map((p) => (
          <li key={p.id} className="grid grid-cols-[56px_1fr_auto] items-center gap-4 py-3 sm:grid-cols-[56px_1fr_120px_120px_100px]">
            <div className="relative size-14 overflow-hidden rounded-xl bg-evergreen/30"><ProductImage src={p.images[0]} alt="" sizes="56px" /></div>
            <div className="min-w-0">
              <p className="truncate font-medium">{p.title}</p>
              <p className="text-[12px] text-mist">{p.category} · {p.status.toLowerCase()}{p.negotiable && " · negotiable"}</p>
            </div>
            <p className="num hidden text-right text-[13px] sm:block">{formatUsd(p.priceCents)}{p.floorPriceCents != null && <span className="block text-[11px] text-dim">floor {formatUsd(p.floorPriceCents)}</span>}</p>
            <p className="num hidden text-right text-[13px] sm:block">{(p.inventory?.available ?? 0) - (p.inventory?.reserved ?? 0)} avail<span className="block text-[11px] text-dim">{p.inventory?.reserved ?? 0} reserved</span></p>
            <button className="btn btn-ghost btn-sm justify-self-end" onClick={() => setEditing(p)}>Edit</button>
          </li>
        ))}
      </ul>
      <AnimatePresence>{editing && <ProductSheet store={store} row={editing === "new" ? null : editing} onClose={() => { setEditing(null); void q.refetch(); }} />}</AnimatePresence>
    </div>
  );
}

function ProductSheet({ store, row, onClose }: { store: MyStore; row: Row | null; onClose: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [f, setF] = useState({
    title: row?.title ?? "",
    category: row?.category ?? "",
    price: row ? String(row.priceCents / 100) : "",
    floor: row?.floorPriceCents != null ? String(row.floorPriceCents / 100) : "",
    inventory: row ? String(row.inventory?.available ?? 0) : "1",
    description: row?.description ?? "",
    shippingInfo: row?.shippingInfo ?? "",
    images: row?.images ?? [],
    imageUrl: "",
    assets: (row?.acceptedAssets ?? ["USDG", "ETH", "USDC", "BNB"]) as PaymentAsset[],
    digital: row?.deliveryType === "DIGITAL",
    negotiable: row?.negotiable ?? false,
    status: row?.status ?? "ACTIVE",
    specs: Object.entries(row?.specs ?? {}).map(([k, v]) => `${k}: ${v}`).join("\n"),
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function save() {
    setBusy(true);
    try {
      const body = {
        title: f.title,
        category: f.category,
        priceCents: Math.round(Number(f.price) * 100),
        floorPriceCents: f.negotiable && f.floor ? Math.round(Number(f.floor) * 100) : null,
        inventory: Number(f.inventory),
        description: f.description,
        shippingInfo: f.shippingInfo,
        images: f.images,
        acceptedAssets: f.assets,
        deliveryType: f.digital ? "DIGITAL" : "PHYSICAL",
        negotiable: f.negotiable,
        status: f.status,
        specs: Object.fromEntries(f.specs.split("\n").map((l) => l.split(":")).filter((p) => p.length >= 2 && p[0].trim()).map(([k, ...v]) => [k.trim(), v.join(":").trim()])),
      };
      if (row) await api(`/merchant/products/${row.id}`, { method: "PATCH", json: body });
      else await api(`/merchant/stores/${store.id}/products`, { json: body });
      toast({ title: row ? "Product updated" : "Product listed", tone: "ok" });
      onClose();
    } catch (e: any) {
      toast({ title: "Could not save product", body: e.details ? JSON.stringify(e.details.fieldErrors ?? e.details) : e.message, tone: "error" });
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <motion.aside initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }} className="absolute right-0 top-0 flex h-full w-full max-w-xl flex-col border-l hairline bg-obsidian-2">
        <div className="flex h-16 items-center justify-between border-b hairline px-6">
          <h2 className="display text-[26px]">{row ? "Edit product" : "New product"}</h2>
          <button className="btn btn-ghost btn-sm !px-2" onClick={onClose} aria-label="Close"><Close size={17} /></button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto p-6">
          <Field label="Title"><input className="field" value={f.title} onChange={set("title")} /></Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Category"><input className="field" value={f.category} onChange={set("category")} placeholder="e.g. Cameras" /></Field>
            <Field label="Status">
              <select className="field" value={f.status} onChange={set("status")}><option value="ACTIVE">Active</option><option value="DRAFT">Draft</option><option value="ARCHIVED">Archived</option></select>
            </Field>
            <Field label="Price (USD)"><input className="field num" inputMode="decimal" value={f.price} onChange={set("price")} /></Field>
            <Field label="Inventory"><input className="field num" inputMode="numeric" value={f.inventory} onChange={set("inventory")} /></Field>
          </div>
          <Field label="Images">
            <div className="flex flex-wrap gap-2">
              {f.images.map((src) => (
                <button key={src} className="relative size-16 overflow-hidden rounded-lg border hairline" onClick={() => setF((x) => ({ ...x, images: x.images.filter((i) => i !== src) }))} title="Remove">
                  <ProductImage src={src} alt="" sizes="64px" />
                </button>
              ))}
            </div>
            <div className="mt-2 flex gap-2">
              <ImageUpload label="Upload image" onUploaded={(url) => setF((x) => ({ ...x, images: [...x.images, url] }))} />
              <input className="field !h-8 flex-1 text-[13px]" placeholder="…or paste an https image URL" value={f.imageUrl} onChange={set("imageUrl")} onKeyDown={(e) => { if (e.key === "Enter" && f.imageUrl) { setF((x) => ({ ...x, images: [...x.images, x.imageUrl], imageUrl: "" })); } }} />
            </div>
          </Field>
          <Field label="Description"><textarea className="field" rows={4} value={f.description} onChange={set("description")} /></Field>
          <Field label="Specifications (one per line, Key: Value)"><textarea className="field num text-[13px]" rows={3} value={f.specs} onChange={set("specs")} /></Field>
          <Field label="Shipping or delivery details"><input className="field" value={f.shippingInfo} onChange={set("shippingInfo")} /></Field>
          <div className="flex flex-wrap gap-4 text-[13.5px]">
            {(["robinhood", "bnb"] as const).map((n) => (
              <div key={n} className="flex w-full flex-wrap gap-4">
                <span className="w-full text-[11px] text-dim">{NETWORK_LABEL[n]}</span>
                {assetsOn(n).map((a) => (
                  <Check key={a} label={`Accept ${a}`} on={f.assets.includes(a)} toggle={() => setF((x) => ({ ...x, assets: x.assets.includes(a) ? x.assets.filter((y) => y !== a) : [...x.assets, a] }))} />
                ))}
              </div>
            ))}
            <Check label="Digital delivery" on={f.digital} toggle={() => setF((x) => ({ ...x, digital: !x.digital }))} />
          </div>
          <div className="rounded-2xl border hairline p-4">
            <Check label="Allow AI negotiation" on={f.negotiable} toggle={() => setF((x) => ({ ...x, negotiable: !x.negotiable }))} />
            {f.negotiable && (
              <div className="mt-3">
                <Field label="Floor price (USD) · your sales agent never accepts below this. Buyers never see it.">
                  <input className="field num" inputMode="decimal" value={f.floor} onChange={set("floor")} />
                </Field>
              </div>
            )}
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t hairline p-4">
          {row && <button className="btn btn-ghost mr-auto" onClick={async () => { await api(`/merchant/products/${row.id}`, { method: "DELETE" }); onClose(); }}>Archive</button>}
          <button className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save"}</button>
        </div>
      </motion.aside>
    </motion.div>
  );
}

const Field = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <div><p className="label">{label}</p>{children}</div>
);
const Check = ({ label, on, toggle }: { label: string; on: boolean; toggle: () => void }) => (
  <label className="flex cursor-pointer items-center gap-2">
    <input type="checkbox" checked={on} onChange={toggle} className="size-4 accent-[#C6A978]" /> {label}
  </label>
);
