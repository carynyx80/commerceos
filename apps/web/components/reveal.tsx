import type { ReactNode } from "react";

/** Entrance animation in pure CSS, so content is visible before (and without) JavaScript. */
export function Reveal({ children, delay = 0, y = 14 }: { children: ReactNode; delay?: number; y?: number }) {
  return (
    <div className="reveal" style={{ animationDelay: `${delay}s`, ["--reveal-y" as string]: `${y}px` }}>
      {children}
    </div>
  );
}
