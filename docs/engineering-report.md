# Commerce OS — engineering report

Date: 2026-10-22 · Repository: local `commerce-os` (no remote configured) · Network tested: local Anvil devnet (31337)

## 1. Fully implemented

- **Web** (Next.js 15, Tailwind 4, Motion): landing with illustrative hero demo (labelled) and live DB stats; Explore (search, category/price/seller/asset filters, negotiable/in-stock toggles, four sorts, pagination, mobile filter sheet); product page (gallery, specs, stock, asset choice, buy now, cart, negotiate, escrow and refund info, verified reviews); store pages; cart (guest local + server cart, merged on sign-in); saved products; checkout with step-by-step escrow progress; orders list/detail with buyer and seller on-chain actions, disputes and reviews; AI workspace (three zones; tabs on mobile); direct negotiation panel; Agent Studio (create/edit policy, pause/resume/revoke, smart-account deploy → authorize → write policy → link → fund/withdraw → on-chain revoke, tasks, activity, negotiations, purchases); seller dashboard (onboarding, analytics from confirmed orders, products with uploads and floor prices, orders with tracking, offers, sales agent, store settings and payout wallet); admin console (overview, escrow on-chain status and pause, kill switches, users, merchants, moderation, orders, disputes, agents, security/failed jobs); notifications; developers, policies, status pages; honest "not configured" and "API unreachable" states.
- **API** (NestJS 11): SIWE auth, hashed sessions, CSRF + Origin checks, roles, rate limiting, request ids, structured errors, OpenAPI at `/docs`, health; catalog/search/stores/stats; cart/saved; merchant stores/products/analytics; uploads; checkout quotes; orders, tracking, disputes, evidence, reviews; negotiations; agents/conversations/tasks; admin.
- **Worker**: Postgres SKIP LOCKED job queue with retries/backoff/idempotency keys and stale-lock recovery; escrow indexer with confirmations, idempotent storage, reorg rewind and event-derived state; payment verification; registry sync; order expiry; seller agent; buyer agent turns; autonomous payments with simulation before send.
- **Contracts**: all seven required contracts plus `AgentAccount`, test token and mock feed; deploy script with mainnet guards.
- **Database**: 27 models, two migrations, FKs, unique constraints, indexes, transactional inventory reservation.

## 2. Verified by automated tests

| Suite | Result |
|---|---|
| Foundry unit + fuzz (`CommerceEscrow`, `AgentPolicy`, `BnbChain`) | 46 passed (fuzz 512 runs each) |
| Foundry invariants (solvency, liabilities = open orders, conservation) | 3 passed (128 runs × 64 calls) |
| `packages/shared` unit tests | 12 passed |
| API end-to-end against the live local stack (two local chains) | **23 passed** |
| `next build` production build | passed (19 routes) |
| TypeScript (`tsc --noEmit`) for web, api, worker, agent-core | clean |

Critical journeys covered by the e2e suite: 1–2 SIWE sign-in and replay rejection, CSRF rejection, 3–4 storefront + product + on-chain registry sync, 5–6 search + cart, client price ignored, 7–12 USDG payment → funded → fulfilled → confirmed → seller +98 / treasury +2, 13 ETH payment, 14 agent creation, 15 agent search, 16 agent ↔ seller-agent negotiation within both sides' limits, 17 agent checkout preparation (manual and autonomous), 18 autonomous purchase from the smart account, 19 over-limit rejected off-chain **and** by the policy contract when the database policy is loosened, 20 on-chain and off-chain revocation, 21 seller-cancel refund in the same asset, 22 dispute locks funds, 23 duplicate payment submission is idempotent and a re-paid quote reverts, plus oversell protection. The contracts additionally cover dispute splits, appeals, timeouts, pause, fee timelock, reverting receivers, stale/invalid oracle data and the rolling window.

Journey 24 (desktop and mobile) was checked manually in the browser: no horizontal overflow at 375 px on the landing page and workspace; navigation, filters and workspace reorganise into a menu, a sheet and tabs.

**BNB Chain (USDC + BNB)**, added 2026-10-22: same contracts on a second chain; `AgentPolicyModule` now reads the stablecoin's decimals (BNB Chain USDC has 18). Tested: 18-decimal USDC escrow with the exact 98/2 split, BNB escrow, agent limits valued correctly in 18-decimal USDC and in BNB via the feed, USDC and BNB checkouts end to end on a local BNB devnet, assets refused when the listing doesn't accept them, and a BNB Chain quote refused by the Robinhood escrow. A USDC checkout on BNB Chain was also completed in the browser (wallet switched networks automatically).

## 3. Verified against live infrastructure

- Robinhood Chain **mainnet** read-only checks: chain id 4663, USDG name/symbol/decimals (6), supply, proxy implementation (see `docs/chain-verification.md`).
- Everything else ran against a **local** Anvil devnet and an embedded PostgreSQL 17. In the browser preview: SIWE sign-in, USDG approve + escrow payment confirmed by the indexer, and a live offer → seller-agent counter.
- **Live OpenAI (gpt-4.1-mini)**, 2026-10-22: the buyer agent searched real listings and reported price, stock and seller verification that matched the database; it flagged a demo listing and an unverified seller; it negotiated a field watch at $430 → $450 against the seller agent ($460 → held at $460) and did not accept above the user's $450 ceiling. Live testing found and fixed: tool schemas OpenAI rejected, a cents/dollars mix-up (the agent once offered $4.50), ids lost between turns (the agent guessed an id), a seller agent that raised its own counter, a worker loop that blocked the seller's reply during an agent turn, and a double-applied state transition under concurrent indexing. Known remaining quirk: the agent sometimes words a re-counter as "declined", and does not always mention demo listings.
- BNB Chain **mainnet** read-only: chain id 56, USDC decimals (18) and proxy, Chainlink BNB/USD feed live (see `docs/chain-verification.md`).
- **Not** deployed to Robinhood testnet or mainnet, or to BNB Chain testnet or mainnet. **Not** deployed to Vercel. No GitHub remote was provided, so nothing was pushed.

## 4. Requires external credentials or accounts

- `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` — WalletConnect is wired but untested without a project id.
- Robinhood testnet deployer key + testnet ETH, a dedicated RPC, a hosted Postgres, API/worker hosting, Vercel project, GitHub remote.
- A verified ETH/USD price feed address on Robinhood Chain (mainnet deploy refuses without it).

## 5. Awaiting security review

All contracts (`CommerceEscrow`, `MerchantRegistry`, `FeeController`, `Treasury`, `DisputeResolver`, `AgentPolicyModule`, `AgentAccount`, `AgentAccountFactory`). `AgentAccount` is a custom minimal account rather than an audited ERC-4337 implementation, chosen because 4337 infrastructure on Robinhood Chain is unverified. Foundry lint warnings (timestamp use, event-after-call ordering) were reviewed but not formally triaged.

## 6. Not yet completed / known deviations

- An agent's smart account lives on one chain; it pays autonomously only in that chain's two assets. Purchases in the other chain's assets go to the user for approval.
- BSC testnet (97) and mainnet (56) deployments not done; `deployments.ts` imports only 31337, 31338, 46630 and 97.

- **Redis** is not used; the queue is Postgres-backed (durable, transactional). Rate limiting is in-memory per API instance — add a shared store before running several API replicas.
- **Object storage**: uploads go to local disk; production needs S3-compatible storage.
- **Encryption at rest** for shipping addresses and evidence is not implemented at field level.
- **Email/push notifications**: in-app only.
- **Arbiter UI**: disputes are visible in admin, but rulings are made directly on `DisputeResolver` from an arbiter wallet; there is no ruling form yet.
- **Product variants** exist in the schema but are not editable in the UI.
- **Browser e2e (Playwright)** is not automated; browser flows were verified manually in the preview.
- **Buyer cancel** for missed fulfilment deadlines is in the contract and API flow but only the accept-timeout case is surfaced in the order page.
- e2e tests run against the development database and leave their stores/orders in it; point them at `commerce_os_test` in CI.

## Mainnet readiness

Not ready. Passing tests on a local devnet is not a security sign-off. The gate in `docs/deployment.md` (audit, verified feeds, multisig/timelock, monitoring, controlled-value pilot) must be completed first.
