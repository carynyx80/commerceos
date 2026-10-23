import { serverApi } from "@/lib/api";

export const dynamic = "force-dynamic";
export const metadata = { title: "Status" };

export default async function Status() {
  const h = await serverApi<any>("/health").catch(() => null);
  const rows: [string, boolean | null, string][] = h
    ? [
        ["API", true, "responding"],
        ["Database", h.database, h.database ? "connected" : "unreachable"],
        ["Escrow contracts", h.contracts, h.contracts ? `deployed on chain ${h.chainId}` : `not deployed on chain ${h.chainId}`],
        ["Checkout signer", h.quoteSigner, h.quoteSigner ? "configured" : "missing"],
        ["AI agents", h.ai === "configured", h.ai],
        ["Blockchain indexer", !!h.indexer, h.indexer ? `block ${h.indexer.block}` : "not started"],
      ]
    : [["API", false, "unreachable"]];
  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-12 sm:px-6">
      <p className="eyebrow">System</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,60px)]">Status</h1>
      <ul className="mt-10 divide-y divide-line border-y hairline">
        {rows.map(([k, ok, v]) => (
          <li key={k} className="flex items-center justify-between py-4">
            <span className="flex items-center gap-3"><span className={`size-2 rounded-full ${ok ? "bg-ok" : "bg-danger"}`} />{k}</span>
            <span className="num text-[13px] text-mist">{v}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
