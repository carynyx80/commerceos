# Architecture

```
Browser ──► Next.js (Vercel) ──/api rewrite──► NestJS API ──► PostgreSQL
   │                                             │   ▲
   │ wallet txs (wagmi/viem)                     │   │ jobs (SKIP LOCKED queue)
   ▼                                             ▼   │
Robinhood Chain ◄──────── reads/writes ──────── Worker ──► OpenAI (tool calling)
 CommerceEscrow · MerchantRegistry · FeeController · Treasury · DisputeResolver
 AgentPolicyModule · AgentAccount(Factory)
```

## Request path

- The web app calls `/api/*` on its own origin; Next rewrites to the API. Session cookies stay first-party (`SameSite=Lax`, `httpOnly`).
- Every state-changing request with a session must carry `x-csrf-token` equal to the session's token, plus an allowed `Origin`.
- Validation uses the zod schemas in `packages/shared`, shared with the web app.

## Checkout

1. `POST /checkout/quote` — `createCheckoutQuote` loads the product, applies an accepted negotiation if the buyer owns one, checks the seller is active in `MerchantRegistry`, converts USD cents to USDG (×10⁴) or wei (ETH/USD feed, rounded up, stale data rejected), reserves stock with a conditional `UPDATE`, creates the order, and signs `Quote{orderId, buyer, seller, token, amount, deadline, termsHash}`.
2. The buyer's wallet calls `payWithToken` (after `approve`) or `payWithEth`.
3. `POST /orders/:id/payment` records the tx hash and queues `payment.verify`. The order is still `AWAITING_PAYMENT`.
4. The indexer stores `OrderFunded`, checks buyer/seller/amount against the order, and moves it to `FUNDED`.
5. Seller `accept` → `markFulfilled`; buyer `confirmDelivery` (or anyone `releaseAfterWindow` after 7 days) → 98% seller / 2% treasury.

Unpaid orders expire after the quote deadline and release their stock. A late payment for an expired order is still honoured (the chain is the source of truth).

## Order state

`deriveOrderState` (packages/blockchain) recomputes state from the full set of confirmed events, so re-indexing, retries and duplicate submissions are idempotent. `IN_FULFILLMENT` is an off-chain refinement of `ACCEPTED` set when the seller adds tracking.

## Indexer

- Polls `getLogs` from a stored cursor up to `head − CONFIRMATIONS`.
- Events are unique by `(chainId, txHash, logIndex)`.
- Before each pass it checks the cursor block hash; on mismatch it rewinds 64 blocks, deletes events above, re-derives affected orders and re-indexes.

## Jobs

`Job` rows are claimed with `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED)`. Retries back off exponentially to `maxAttempts`. Stale `RUNNING` jobs (crashed worker) are reclaimed after 5 minutes. Callers pass idempotency keys (`payment.verify:<tx>`, `agent.pay:<order>`, `seller_respond:<offer>`). Transactions from one signing key are serialized to avoid nonce races.

Redis was specified for queues/caching. This build uses Postgres for the queue because it gives transactional enqueue with the business write and survives restarts without another service; Redis can be added for caching/rate-limit storage without changing the job contract.

## Agents

- **Buyer agent** (`packages/agent-core/orchestrator.ts`): OpenAI chat completions with typed tools (`search_products`, `get_product`, `get_seller`, `compare_products`, `check_spending_policy`, `start_negotiation`, `make_offer`, `check_negotiation`, `accept_counter`, `prepare_checkout`, `execute_purchase`, `track_orders`). Max 10 model steps / 16 tool calls per turn. Tool results are persisted per `(task, tool_call_id)` so a retried task reuses them. Third-party text is returned under `untrusted` keys.
- **Seller agent**: `sellerDecision` (packages/shared) — accept at/near list, counter between offer and list never below floor, accept at floor in late rounds, reject below floor at the end. An LLM, when configured, only words the reply.
- **Workspace**: each message creates an `AgentTask` and an `agent.run` job; tool starts write `event` messages that drive the UI's activity states; the final assistant message stores the "intelligence" extracted from tool results for the right panel.

## Autonomous payments

`AgentAccount` is a minimal smart account owned by the user's wallet. Its agent key (the Commerce OS executor) can only call `agentCheckout(quote, sig, expectedNonce)`, which asks `AgentPolicyModule.authorize` to check revocation, expiry, nonce, asset, merchant allowlist, per-order USD value (oracle-priced for ETH) and the rolling window, then pays the escrow with a scoped, reset approval. Owner-only `execute` covers withdrawals, delivery confirmation and disputes.

This is deliberately **not** ERC-4337: bundler/paymaster/EntryPoint support on Robinhood Chain was not verified, so the executor submits its own transaction and pays gas. The contracts are small, use OpenZeppelin primitives, and are unaudited.
