# Security model

## Funds

| Threat | Control |
|---|---|
| Admin drains escrow | No function moves escrowed funds except to that order's buyer/seller/treasury. Invariant tests check `balance ≥ liabilities` and `liabilities == open orders`. |
| Buyer pays less than quoted | Amount is inside the EIP-712 quote; tampering fails signature recovery. Token transfers are balance-delta checked (no fee-on-transfer). ETH requires `msg.value == amount`. |
| Quote replay / double payment | `orderId` can be funded once (`OrderExists`). Quotes expire. Agent payments also consume the policy nonce. |
| Receiver reverts / USDG blocklist | `_send` credits `owed[to]` instead of reverting, so one party cannot lock the other's funds; `withdraw` pulls later. ETH push uses a gas-capped, no-returndata call. |
| Fee change front-runs orders | Fee snapshotted per order; changes need a 1-day delay; hard cap 10%. |
| Emergency | `pause` stops new payments and releases; refunds, disputes and withdrawals stay available. Pauser/owner intended to be a multisig. |
| Disputes | Funds locked; arbiter ruling → 3-day appeal window → appeals multisig. Evidence stays off-chain (hash only). |

## Agents

- The AI never holds a user key. The agent key can only pay server-signed escrow quotes from the user's AgentAccount.
- `AgentPolicyModule` enforces limits on-chain; the off-chain mirror only explains decisions early. Tests cover a deliberately loosened database policy being rejected by the contract.
- ETH is valued with a Chainlink-style feed; non-positive, incomplete-round or stale (> 1 h) answers are rejected. USDG is counted 1:1 unless a USDG/USD feed is set — set it before mainnet so a depeg cannot widen limits.
- Prompt injection: third-party text is returned in `untrusted` fields, tools validate their own permissions, and no tool can change limits.
- Kill switches: `agents.paused` and `checkout.paused` (admin, audited); on-chain `revoke(account)` by the owner.

## Web / API

- SIWE with single-use nonces (atomic consume), domain and chain checks, ERC-1271 fallback when an RPC is configured.
- Sessions: random 256-bit token, stored hashed, `httpOnly`, `SameSite=Lax`, `Secure` in production, bound to one wallet; switching wallets ends the session.
- CSRF: per-session token required on every state-changing request, plus Origin allowlist.
- Role checks: merchant ownership checked on every store/product/order action; admin routes require `ADMIN` (granted via `ADMIN_ADDRESSES`).
- Rate limiting (300 req/min/IP), structured errors with request ids, `x-request-id` tracing, security headers on the web app.
- Floor prices are never serialized to buyers or agents. Shipping addresses and dispute evidence are stored off-chain and only returned to the buyer, seller or admin. Encrypt the database at rest in production.
- Uploads: images only, magic-byte checked, 5 MB cap, content-addressed names.

## Known gaps before mainnet

1. Independent audit of all contracts.
2. Multisig + `TimelockController` ownership (deploy script refuses mainnet without a separate `ADMIN`).
3. A verified ETH/USD feed on Robinhood Chain (required by the deploy script) and a USDG/USD feed.
4. Field-level encryption for `Order.shipping` and dispute evidence.
5. Production object storage for media.
