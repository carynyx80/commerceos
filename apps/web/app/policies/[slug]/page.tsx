import { notFound } from "next/navigation";

const PAGES: Record<string, { title: string; body: string[] }> = {
  disputes: {
    title: "Disputes",
    body: [
      "A buyer or seller can open a dispute while an order is funded, accepted, or within the confirmation window after fulfilment. Opening a dispute locks the funds in escrow.",
      "Both sides submit evidence to Commerce OS during a five-day evidence period. Evidence stays off-chain because it may contain private details; only its hash is recorded.",
      "An independent arbiter rules on-chain how the payment is split. Either side may appeal once within three days, and the appeals multisig makes the final decision. Unappealed rulings settle automatically when the window closes.",
      "Physical delivery cannot be proven on-chain. Arbiters weigh tracking information, photos, and messages.",
    ],
  },
  security: {
    title: "Security",
    body: [
      "Escrowed funds can only move to the buyer, the seller, or (fee only) the treasury of that order. No administrator function can withdraw them.",
      "Contract administration (fees, quote signer, pause) is intended for a multisig behind a timelock. Fee changes are delayed by at least one day and capped at 10%.",
      "AI agents never hold your private keys. An agent can only pay server-signed escrow quotes from a smart account you own, and the AgentPolicyModule contract enforces your per-order, rolling, asset, merchant, and expiry limits.",
      "The contracts have unit, fuzz, and invariant tests but have not been independently audited. Do not deposit significant value until an audit is complete.",
    ],
  },
};

export default async function Policy({ params }: { params: Promise<{ slug: string }> }) {
  const p = PAGES[(await params).slug];
  if (!p) notFound();
  return (
    <div className="mx-auto max-w-2xl px-4 pb-10 pt-12 sm:px-6">
      <p className="eyebrow">Policy</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,60px)]">{p.title}</h1>
      <div className="mt-8 space-y-5 text-[15.5px] leading-relaxed text-porcelain/85">{p.body.map((b) => <p key={b}>{b}</p>)}</div>
    </div>
  );
}
