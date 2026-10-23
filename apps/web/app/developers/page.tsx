import Link from "next/link";

export const metadata = { title: "Developers" };

const ENDPOINTS: [string, string, string][] = [
  ["GET", "/api/catalog/search?q=&category=&minPrice=&maxPrice=&asset=&sort=", "Search live listings (prices in USD cents)."],
  ["GET", "/api/catalog/products/:id", "Product detail, stock and verified reviews."],
  ["GET", "/api/stores/:slug", "Storefront with products and settled-order count."],
  ["POST", "/api/auth/nonce → /api/auth/verify", "Sign-In with Ethereum. Returns an httpOnly session cookie plus a CSRF token cookie."],
  ["POST", "/api/checkout/quote", "Server-priced, EIP-712-signed escrow quote; creates the order."],
  ["POST", "/api/orders/:id/payment", "Report a payment tx. Orders become FUNDED only from confirmed escrow events."],
  ["POST", "/api/negotiations, /:id/offers, /:id/accept", "Structured offers with terms hash and expiry."],
  ["GET", "/api/health", "Database, contracts, signer, AI and indexer status."],
];

export default function Developers() {
  return (
    <div className="mx-auto max-w-[1100px] px-4 pb-10 pt-12 sm:px-6">
      <p className="eyebrow">Developers</p>
      <h1 className="display mt-3 text-[clamp(40px,5vw,64px)]">Build on Commerce OS</h1>
      <p className="mt-4 max-w-2xl text-mist">A REST API for the marketplace and a set of escrow contracts on Robinhood Chain. The interactive OpenAPI reference is served by the API at <span className="num text-porcelain">/docs</span>.</p>
      <section className="surface mt-10 overflow-hidden rounded-2xl">
        <table className="w-full text-[13.5px]">
          <tbody>
            {ENDPOINTS.map(([m, p, d]) => (
              <tr key={p} className="border-b hairline last:border-0">
                <td className="num w-20 px-5 py-3.5 align-top text-champagne">{m}</td>
                <td className="py-3.5 pr-5 align-top"><p className="num break-all text-porcelain">{p}</p><p className="mt-1 text-mist">{d}</p></td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
      <section className="mt-10 grid gap-6 md:grid-cols-2">
        <div className="surface rounded-2xl p-6">
          <p className="eyebrow mb-3">Contracts</p>
          <ul className="num space-y-1.5 text-[13px] text-porcelain/85">
            <li>CommerceEscrow · payWithToken / payWithEth / confirmDelivery</li>
            <li>MerchantRegistry · active payout wallets</li>
            <li>FeeController · 2% fee, 10% cap, 1-day change delay</li>
            <li>DisputeResolver · evidence → ruling → appeal</li>
            <li>AgentPolicyModule · per-order, rolling, asset, merchant, expiry</li>
            <li>AgentAccount(Factory) · agent key can only pay quotes</li>
            <li>Treasury · protocol fees only</li>
          </ul>
        </div>
        <div className="surface rounded-2xl p-6">
          <p className="eyebrow mb-3">Status</p>
          <p className="text-[13.5px] text-mist">Contracts are unaudited and deployed to local and test networks only. Mainnet deployment is gated on an independent audit. See <Link href="/policies/security" className="text-champagne">security</Link>.</p>
        </div>
      </section>
    </div>
  );
}
