import Link from "next/link";
import { Mark } from "./icons";

export function Footer() {
  return (
    <footer className="mt-32 border-t hairline">
      <div className="mx-auto grid max-w-[1440px] gap-12 px-4 py-16 sm:px-6 md:grid-cols-[1.4fr_1fr_1fr_1fr] lg:px-10">
        <div>
          <div className="flex items-center gap-2.5"><Mark /> <span className="font-medium">Commerce <span className="text-champagne">OS</span></span></div>
          <p className="display mt-6 max-w-xs text-[30px] text-porcelain/90">Commerce, without boundaries.</p>
          <p className="mt-3 max-w-xs text-[13px] text-mist">The operating system for autonomous commerce. Settled on Robinhood Chain in USDG and ETH.</p>
        </div>
        <FooterCol title="Marketplace" links={[["Explore", "/explore"], ["AI Commerce", "/workspace"], ["Saved", "/saved"], ["Orders", "/orders"]]} />
        <FooterCol title="Build" links={[["Sell on Commerce OS", "/sell"], ["Agent Studio", "/agents"], ["Developers", "/developers"], ["How it works", "/#how"]]} />
        <FooterCol title="Protocol" links={[["Escrow & refunds", "/#escrow"], ["Disputes", "/policies/disputes"], ["Security", "/policies/security"], ["Status", "/status"]]} />
      </div>
      <div className="mx-auto flex max-w-[1440px] flex-col gap-2 border-t hairline px-4 py-6 text-[12px] text-dim sm:flex-row sm:justify-between sm:px-6 lg:px-10">
        <span>© {new Date().getFullYear()} Commerce OS. Escrow contracts are pending independent audit.</span>
        <span className="num">Robinhood Chain · USDG · ETH</span>
      </div>
    </footer>
  );
}

function FooterCol({ title, links }: { title: string; links: [string, string][] }) {
  return (
    <div>
      <p className="eyebrow mb-4">{title}</p>
      <ul className="space-y-2.5 text-[14px]">
        {links.map(([l, h]) => (
          <li key={h}><Link href={h} className="text-mist hover:text-porcelain">{l}</Link></li>
        ))}
      </ul>
    </div>
  );
}
