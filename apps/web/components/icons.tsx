import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };
const base = (size = 16): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
});

export const Search = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="6.5" /><path d="m20 20-4-4" /></svg>
);
export const Bag = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 8h14l-1 12H6L5 8Z" /><path d="M9 8V6a3 3 0 0 1 6 0v2" /></svg>
);
export const Arrow = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12h14M13 6l6 6-6 6" /></svg>
);
export const Close = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12M18 6 6 18" /></svg>
);
export const Menu = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 8h16M4 16h16" /></svg>
);
export const Spark = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5 18 18M6 18l2.5-2.5M15.5 8.5 18 6" /></svg>
);
export const Shield = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 3 5 6v6c0 4.5 3 7.5 7 9 4-1.5 7-4.5 7-9V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></svg>
);
export const Check = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="m5 12.5 4.5 4.5L19 7.5" /></svg>
);
export const Heart = ({ size, filled, ...p }: P & { filled?: boolean }) => (
  <svg {...base(size)} {...p} fill={filled ? "currentColor" : "none"}><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10Z" /></svg>
);
export const Store = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M4 9.5 5.5 4h13L20 9.5M4 9.5V20h16V9.5M4 9.5c0 1.4 1.1 2.5 2.7 2.5S9.3 10.9 9.3 9.5c0 1.4 1.2 2.5 2.7 2.5s2.7-1.1 2.7-2.5c0 1.4 1.2 2.5 2.6 2.5S20 10.9 20 9.5" /><path d="M10 20v-5h4v5" /></svg>
);
export const Bot = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="4.5" y="7.5" width="15" height="11" rx="3" /><path d="M12 4v3.5M9 12.5h.01M15 12.5h.01M9.5 15.5h5" /></svg>
);
export const Lock = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><rect x="5" y="10.5" width="14" height="10" rx="2" /><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" /></svg>
);
export const Pulse = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M3 12h4l2.5-6 5 12L17 12h4" /></svg>
);
export const Plus = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M12 5v14M5 12h14" /></svg>
);
export const Minus = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12h14" /></svg>
);
export const External = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4" /></svg>
);
export const Bell = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16Z" /><path d="M10 20.5a2 2 0 0 0 4 0" /></svg>
);
export const Send = ({ size, ...p }: P) => (
  <svg {...base(size)} {...p}><path d="M5 12 20 4l-4 16-4-6.5L5 12Z" /><path d="m12 13.5 8-9.5" /></svg>
);

export function Mark({ size = 22 }: { size?: number }) {
  // Commerce OS mark: an open ring (commerce loop) around a settled point (escrow).
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <path d="M26 10.5A11 11 0 1 0 26 21.5" fill="none" stroke="#C6A978" strokeWidth="2.2" strokeLinecap="round" />
      <path d="M21 13.2A5.6 5.6 0 1 0 21 18.8" fill="none" stroke="#F2F0E8" strokeWidth="2.2" strokeLinecap="round" />
      <circle cx="26.2" cy="16" r="1.9" fill="#91A99A" />
    </svg>
  );
}
