import { chainById, deploymentFor } from "@commerce-os/blockchain";

const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const chain = chainById(CHAIN_ID);

/** Always tell people which network they are on and whether the money is real. */
export function NetworkBanner() {
  if (CHAIN_ID === 4663) return null;
  const d = deploymentFor(CHAIN_ID);
  return (
    <div className="border-b hairline bg-evergreen/40 px-4 py-1.5 text-center text-[12px] text-sage">
      <span className="num">{chain.name}</span> · test environment — no real funds
      {!d && " · escrow contracts not deployed on this network yet"}
    </div>
  );
}
