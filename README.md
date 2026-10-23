# Commerce OS

**Commerce, without boundaries.** An AI-native Web3 marketplace on Robinhood Chain: people and businesses buy, sell and negotiate, in person or through AI agents, and settle in USDG or ETH through on-chain escrow.

> Status: feature-complete on a local devnet with automated tests. **Contracts are unaudited.** Not ready for real funds — see [docs/engineering-report.md](docs/engineering-report.md).

## What's here

| Path | What it is |
|---|---|
| `apps/web` | Next.js 15 app: landing, marketplace, product & store pages, checkout, orders, AI workspace, Agent Studio, seller dashboard, admin console |
| `apps/api` | NestJS API: SIWE auth + sessions + CSRF, catalog/search, cart, merchant, checkout quotes, orders, negotiations, agents, admin, uploads, health, OpenAPI at `/docs` |
| `apps/worker` | Durable worker: Postgres job queue, escrow indexer (idempotent, reorg-aware), payment verification, registry sync, order expiry, agent tasks, seller agent, autonomous payments |
| `packages/database` | Prisma schema + migrations, job queue, audit, notifications, local Postgres launcher, fixtures |
| `packages/commerce` | Checkout (server pricing, EIP-712 quotes, inventory reservation), negotiation engine, spending-policy mirror, chain client |
| `packages/agent-core` | OpenAI tool-calling orchestrator, agent tools, autonomous payment executor |
| `packages/blockchain` | Chain config (Robinhood 4663/46630, Anvil), ABIs, deployments, quote typing, event-derived order state |
| `packages/shared` | Money math, order state machine, zod schemas, seller decision function |
| `contracts` | Foundry: CommerceEscrow, MerchantRegistry, FeeController, Treasury, DisputeResolver, AgentPolicyModule, AgentAccount, AgentAccountFactory |
| `infrastructure` | Dockerfile, docker-compose, monitoring notes |
| `docs` | Architecture, security, deployment, chain verification, engineering report |

## Run it locally

Requirements: Node 22, Foundry. No Docker needed.

```bash
npm install
npm run db:start            # embedded Postgres on :54330 (leave running)
npm run db:migrate && npm run db:seed
./scripts/dev-chain.sh      # Anvil on :8545 + contract deploy + throwaway dev keys
```

Create `apps/api/.env` and `apps/worker/.env` from `.env.example` (the dev-chain script prints the keys into `.env.local-chain`), then:

```bash
npm run dev:api             # :4100
npm run dev:worker
npm run dev:web             # :3100
```

On the local devnet the wallet menu offers a **Local devnet test wallet** (Anvil's public dev accounts) so you can sign in and pay without a browser extension. It is never offered on a public network.

Set `OPENAI_API_KEY` to enable the shopping agent. Without it the workspace shows a configuration error; direct negotiation, seller agents (deterministic) and checkout still work.

## Tests

```bash
npm run test:contracts                       # 40 unit + fuzz tests, 3 invariants
npx vitest run --dir packages/shared         # money, state machine, seller decisions
npm run test:e2e -w @commerce-os/api         # 19 end-to-end journeys against the live local stack
```

## Key design decisions

- **Server pricing, signed quotes.** The client never sends a price. The API prices from the database (list or accepted negotiation), reserves stock, and signs an EIP-712 quote that the escrow verifies.
- **Paid means confirmed.** Orders become `FUNDED` only when the indexer sees a confirmed `OrderFunded` event that matches the quote. Submitting a transaction changes nothing.
- **AI proposes, code decides.** The buyer agent can only call typed tools. Seller agents decide with a pure function bounded by merchant floors. Autonomous payments go through `AgentPolicyModule`, which enforces per-order, rolling, asset, merchant and expiry limits on-chain.
- **No admin path to escrow.** Escrowed funds can only reach that order's buyer, seller, or (fee only) treasury.
