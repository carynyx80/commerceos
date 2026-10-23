"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { formatUsd } from "@commerce-os/shared";
import { useCart } from "./cart";
import { Close, Minus, Plus } from "./icons";
import { ProductImage } from "./product-image";

export function CartDrawer() {
  const { open, setOpen, lines, subtotalCents, setQty, remove } = useCart();
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
          <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <motion.aside
            initial={{ x: "100%" }}
            animate={{ x: 0 }}
            exit={{ x: "100%" }}
            transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
            className="absolute right-0 top-0 flex h-full w-full max-w-md flex-col border-l hairline bg-obsidian-2"
            aria-label="Cart"
          >
            <div className="flex h-16 items-center justify-between border-b hairline px-5">
              <h2 className="display text-[26px]">Your cart</h2>
              <button className="btn btn-ghost btn-sm !px-2.5" onClick={() => setOpen(false)} aria-label="Close cart"><Close size={18} /></button>
            </div>
            <div className="flex-1 overflow-y-auto px-5">
              {lines.length === 0 ? (
                <div className="py-16 text-center">
                  <p className="text-mist">Nothing here yet.</p>
                  <Link href="/explore" onClick={() => setOpen(false)} className="btn btn-secondary mt-5">Explore the marketplace</Link>
                </div>
              ) : (
                <ul>
                  <AnimatePresence initial={false}>
                    {lines.map((l) => (
                      <motion.li key={l.productId} layout exit={{ opacity: 0, height: 0 }} className="flex gap-4 border-b hairline py-4">
                        <div className="relative size-20 shrink-0 overflow-hidden rounded-xl bg-evergreen/40">
                          <ProductImage src={l.product.images[0]} alt={l.product.title} sizes="80px" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <Link href={`/product/${l.productId}`} onClick={() => setOpen(false)} className="line-clamp-1 text-[14px] font-medium hover:text-champagne">
                            {l.product.title}
                          </Link>
                          <p className="text-[12px] text-mist">{l.product.store.name}</p>
                          <div className="mt-2 flex items-center justify-between">
                            <div className="flex items-center rounded-full border hairline">
                              <button className="grid size-7 place-items-center text-mist hover:text-porcelain" onClick={() => (l.quantity > 1 ? setQty(l.productId, l.quantity - 1) : remove(l.productId))} aria-label="Decrease"><Minus size={13} /></button>
                              <span className="num w-6 text-center text-[13px]">{l.quantity}</span>
                              <button className="grid size-7 place-items-center text-mist hover:text-porcelain" onClick={() => setQty(l.productId, Math.min(99, l.quantity + 1))} aria-label="Increase"><Plus size={13} /></button>
                            </div>
                            <span className="num text-[14px]">{formatUsd(l.quantity * l.product.priceCents)}</span>
                          </div>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ul>
              )}
            </div>
            {lines.length > 0 && (
              <div className="border-t hairline p-5">
                <div className="flex items-baseline justify-between">
                  <span className="text-mist">Subtotal</span>
                  <span className="num text-[18px]">{formatUsd(subtotalCents)}</span>
                </div>
                <p className="mt-1 text-[12px] text-dim">Final amounts are quoted by the server at checkout. Each seller is paid through its own escrow.</p>
                <Link href="/checkout" onClick={() => setOpen(false)} className="btn btn-primary mt-4 w-full">Checkout</Link>
              </div>
            )}
          </motion.aside>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
