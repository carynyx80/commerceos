"use client";
import { AnimatePresence, motion } from "motion/react";
import { createContext, useCallback, useContext, useState, type ReactNode } from "react";

type Tone = "info" | "ok" | "error";
interface Toast {
  id: number;
  title: string;
  body?: string;
  tone: Tone;
}
const Ctx = createContext<(t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => void>(() => {});
export const useToast = () => useContext(Ctx);

export function Toaster({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((t: Omit<Toast, "id" | "tone"> & { tone?: Tone }) => {
    const id = Date.now() + Math.random();
    setItems((xs) => [...xs, { ...t, tone: t.tone ?? "info", id }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), 6000);
  }, []);
  return (
    <Ctx.Provider value={push}>
      {children}
      <div className="pointer-events-none fixed inset-x-4 bottom-4 z-[100] flex flex-col items-end gap-2 sm:inset-x-auto sm:right-6">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, y: 12, scale: 0.98 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              role="status"
              className="surface-raised pointer-events-auto w-full max-w-sm rounded-2xl px-4 py-3 backdrop-blur"
            >
              <div className="flex items-start gap-3">
                <span
                  className={`mt-1.5 size-1.5 shrink-0 rounded-full ${t.tone === "error" ? "bg-danger" : t.tone === "ok" ? "bg-ok" : "bg-champagne"}`}
                />
                <div className="min-w-0">
                  <p className="text-[14px] font-medium">{t.title}</p>
                  {t.body && <p className="mt-0.5 break-words text-[13px] text-mist">{t.body}</p>}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
