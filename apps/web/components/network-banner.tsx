import { chainById, deploymentFor, isMainnet } from "@commerce-os/blockchain";

const ids = [Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337), ...(process.env.NEXT_PUBLIC_BNB_CHAIN_ID ? [Number(process.env.NEXT_PUBLIC_BNB_CHAIN_ID)] : [])];

/** Always tell people which networks they are on and whether the money is real. */
export function NetworkBanner() {
  const test = ids.filter((id) => !isMainnet(id));
  if (!test.length) return null;
  const missing = ids.filter((id) => !deploymentFor(id));
  return (
    <div className="border-b hairline bg-evergreen/40 px-4 py-1.5 text-center text-[12px] text-sage">
      <span className="num">{test.map((id) => chainById(id).name).join(" · ")}</span> · test environment — no real funds
      {missing.length > 0 && ` · escrow not deployed on ${missing.map((id) => chainById(id).name).join(", ")}`}
    </div>
  );
}
