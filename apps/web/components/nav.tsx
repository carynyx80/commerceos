"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Bag, Close, Mark, Menu, Search } from "./icons";
import { ConnectButton } from "./wallet/connect-button";
import { useCart } from "./cart";
import { NotificationBell } from "./notification-bell";

const LINKS = [
  { href: "/explore", label: "Explore" },
  { href: "/workspace", label: "AI Commerce" },
  { href: "/agents", label: "Agents" },
  { href: "/sell", label: "Sell" },
  { href: "/#how", label: "How It Works" },
];

export function Nav() {
  const path = usePathname();
  const router = useRouter();
  const { count, setOpen } = useCart();
  const [menu, setMenu] = useState(false);
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  useEffect(() => setMenu(false), [path]);

  return (
    <header className="sticky top-0 z-40 border-b hairline bg-obsidian/75 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center gap-6 px-4 sm:px-6 lg:px-10">
        <Link href="/" className="flex shrink-0 items-center gap-2.5" aria-label="Commerce OS home">
          <Mark />
          <span className="text-[15px] font-medium tracking-[-0.01em]">
            Commerce <span className="text-champagne">OS</span>
          </span>
        </Link>
        <nav className="hidden items-center gap-1 lg:flex">
          {LINKS.map((l) => {
            const active = l.href !== "/#how" && path.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`relative rounded-full px-3 py-1.5 text-[13.5px] transition-colors ${active ? "text-porcelain" : "text-mist hover:text-porcelain"}`}
              >
                {active && (
                  <motion.span layoutId="nav-pill" className="absolute inset-0 rounded-full bg-evergreen/70" transition={{ type: "spring", bounce: 0.15, duration: 0.5 }} />
                )}
                <span className="relative">{l.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-1.5 sm:gap-2">
          <button className="btn btn-ghost btn-sm !px-2.5" onClick={() => setSearch(true)} aria-label="Search products">
            <Search size={17} />
          </button>
          <NotificationBell />
          <button className="btn btn-ghost btn-sm relative !px-2.5" onClick={() => setOpen(true)} aria-label={`Cart, ${count} items`}>
            <Bag size={17} />
            {count > 0 && (
              <span className="num absolute -right-0.5 -top-0.5 grid size-4 place-items-center rounded-full bg-champagne text-[10px] font-semibold text-obsidian">
                {count}
              </span>
            )}
          </button>
          <div className="hidden sm:block">
            <ConnectButton compact />
          </div>
          <button className="btn btn-ghost btn-sm !px-2.5 lg:hidden" onClick={() => setMenu(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {search && (
          <motion.div
            className="fixed inset-0 z-50 bg-obsidian/80 backdrop-blur-md"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSearch(false)}
          >
            <motion.form
              initial={{ y: -12, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: -8, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              onClick={(e) => e.stopPropagation()}
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(false);
                router.push(`/explore?q=${encodeURIComponent(q)}`);
              }}
              className="surface-raised mx-auto mt-24 flex w-[min(640px,calc(100%-32px))] items-center gap-3 rounded-2xl px-5"
            >
              <Search size={18} className="text-mist" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearch(false)}
                placeholder="Search products, stores, categories…"
                className="h-14 flex-1 bg-transparent text-[16px] outline-none placeholder:text-dim"
              />
              <kbd className="num hidden text-[11px] text-dim sm:block">↵</kbd>
            </motion.form>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {menu && (
          <motion.div className="fixed inset-0 z-50 bg-obsidian/96 backdrop-blur-xl lg:hidden" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="flex h-16 items-center justify-between px-4">
              <span className="flex items-center gap-2.5"><Mark /> Commerce <span className="text-champagne">OS</span></span>
              <button className="btn btn-ghost btn-sm !px-2.5" onClick={() => setMenu(false)} aria-label="Close menu"><Close size={18} /></button>
            </div>
            <nav className="flex flex-col px-4 pt-6">
              {LINKS.map((l, i) => (
                <motion.div key={l.href} initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.04 * i }}>
                  <Link href={l.href} onClick={() => setMenu(false)} className="display block border-b hairline py-4 text-[34px]">
                    {l.label}
                  </Link>
                </motion.div>
              ))}
              <div className="mt-8"><ConnectButton /></div>
            </nav>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  );
}
