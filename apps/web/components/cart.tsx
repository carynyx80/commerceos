"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { api } from "@/lib/api";
import type { ProductCard } from "@/lib/types";
import { useSession } from "./session";

export interface CartLine {
  productId: string;
  quantity: number;
  product: ProductCard;
}
interface CartCtx {
  lines: CartLine[];
  count: number;
  subtotalCents: number;
  open: boolean;
  setOpen: (v: boolean) => void;
  add: (p: ProductCard, qty?: number) => Promise<void>;
  setQty: (productId: string, qty: number) => Promise<void>;
  remove: (productId: string) => Promise<void>;
}
const Ctx = createContext<CartCtx | null>(null);
export function useCart() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useCart outside provider");
  return c;
}

const LOCAL_KEY = "cos.cart.v1";
function readLocal(): CartLine[] {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) ?? "[]");
  } catch {
    return [];
  }
}
function writeLocal(lines: CartLine[]) {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(lines));
  } catch {
    /* storage unavailable */
  }
}

/** Guests keep a local cart; signed-in users use the server cart. Local lines merge into the server on sign-in. */
export function CartProvider({ children }: { children: ReactNode }) {
  const { me } = useSession();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [local, setLocal] = useState<CartLine[]>([]);
  useEffect(() => setLocal(readLocal()), []);

  const server = useQuery({
    queryKey: ["cart", me?.id],
    enabled: !!me,
    queryFn: () => api<{ lines: CartLine[] }>("/cart"),
  });

  useEffect(() => {
    if (!me) return;
    const pending = readLocal();
    if (!pending.length) return;
    void (async () => {
      for (const l of pending) {
        await api("/cart/items", { json: { productId: l.productId, quantity: l.quantity } }).catch(() => {});
      }
      writeLocal([]);
      setLocal([]);
      await qc.invalidateQueries({ queryKey: ["cart"] });
    })();
  }, [me, qc]);

  const lines = me ? (server.data?.lines ?? []) : local;

  const add = useCallback(
    async (p: ProductCard, qty = 1) => {
      if (me) {
        await api("/cart/items", { json: { productId: p.id, quantity: qty } });
        await qc.invalidateQueries({ queryKey: ["cart"] });
      } else {
        const next = [...readLocal()];
        const i = next.findIndex((l) => l.productId === p.id);
        if (i >= 0) next[i] = { ...next[i], quantity: Math.min(99, next[i].quantity + qty) };
        else next.push({ productId: p.id, quantity: qty, product: p });
        writeLocal(next);
        setLocal(next);
      }
      setOpen(true);
    },
    [me, qc],
  );
  const setQty = useCallback(
    async (productId: string, qty: number) => {
      if (me) {
        await api(`/cart/items/${productId}`, { method: "PATCH", json: { quantity: qty } });
        await qc.invalidateQueries({ queryKey: ["cart"] });
      } else {
        const next = readLocal().map((l) => (l.productId === productId ? { ...l, quantity: qty } : l));
        writeLocal(next);
        setLocal(next);
      }
    },
    [me, qc],
  );
  const remove = useCallback(
    async (productId: string) => {
      if (me) {
        await api(`/cart/items/${productId}`, { method: "DELETE" });
        await qc.invalidateQueries({ queryKey: ["cart"] });
      } else {
        const next = readLocal().filter((l) => l.productId !== productId);
        writeLocal(next);
        setLocal(next);
      }
    },
    [me, qc],
  );

  return (
    <Ctx.Provider
      value={{
        lines,
        count: lines.reduce((s, l) => s + l.quantity, 0),
        subtotalCents: lines.reduce((s, l) => s + l.quantity * l.product.priceCents, 0),
        open,
        setOpen,
        add,
        setQty,
        remove,
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
