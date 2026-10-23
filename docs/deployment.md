# Deployment

## Topology

| Service | Where | Why |
|---|---|---|
| `apps/web` | Vercel (root directory `apps/web`) | Static + RSC; calls the API through the `/api` rewrite (`API_URL`) |
| `apps/api` | Long-running container (Fly, Railway, Render, ECS…) | Sessions, quotes, uploads |
| `apps/worker` | Long-running container, ≥1 instance | Indexer, jobs, agents. Never run on serverless functions. |
| PostgreSQL 15+ | Managed (Neon, RDS, Supabase…) | Set the database timezone to UTC |
| Media | Persistent volume or object storage behind `/api/uploads` | Local disk is not durable on most hosts |

Build images with `infrastructure/deployment/Dockerfile` (`--build-arg APP=api|worker`). Run migrations as a release step: `npm run migrate:deploy -w @commerce-os/database`.

## Environments

- **Preview**: chain 46630 (Robinhood testnet), `TestUSDG`, `AUTONOMOUS_PAYMENTS_ENABLED=false` unless testing agents, separate database.
- **Production**: chain 4663 only after the security gate below.

## Contracts

Deploy once per chain. Robinhood Chain:

```bash
cd contracts
DEPLOYER_PRIVATE_KEY=… QUOTE_SIGNER=0x… REGISTRAR=0x… ADMIN=<multisig> ARBITER=<arbiter> \
STABLE_ADDRESS=0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 NATIVE_USD_FEED=<verified ETH/USD feed> \
forge script script/Deploy.s.sol --rpc-url robinhood --broadcast --verify
```

BNB Chain (same keys; USDC has 18 decimals, read from the token):

```bash
DEPLOYER_PRIVATE_KEY=… QUOTE_SIGNER=0x… REGISTRAR=0x… ADMIN=<multisig> ARBITER=<arbiter> \
STABLE_ADDRESS=0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d NATIVE_USD_FEED=0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE \
forge script script/Deploy.s.sol --rpc-url https://bsc-dataseed.bnbchain.org --broadcast --verify
node ../scripts/gen-abis.mjs
```

Then set `BNB_CHAIN_ID`/`BNB_RPC_URL` on the API and worker and `NEXT_PUBLIC_BNB_CHAIN_ID` on the web app, add `packages/blockchain/deployments/56.json` to `deployments.ts`, and fund the registrar and agent-executor keys with BNB for gas.

The script writes `packages/blockchain/deployments/<chainId>.json`. On mainnets (4663, 56) it refuses to run without a real stablecoin address, a price feed and an `ADMIN` different from the deployer, and it transfers ownership (two-step) to `ADMIN`. The multisig must then `acceptOwnership()` on FeeController, CommerceEscrow and AgentPolicyModule.

## Keys

| Key | Holds | Blast radius |
|---|---|---|
| Quote signer | Signs checkout quotes | Can price orders; cannot move funds. Rotate with `setQuoteSigner`. |
| Registrar | `REGISTRAR_ROLE` on every chain | Can mark payout wallets active. Needs gas (ETH, BNB) on each chain. |
| Agent executor | AgentAccount `agentKey` | Can only call `agentCheckout`, inside each owner's on-chain policy. |
| Admin multisig | Owner/roles | Fees (delayed), pause, signer rotation, arbiter roles. |

Store them in a secrets manager; never in the repository.

## Vercel

Project root `apps/web`. Set `API_URL`, `NEXT_PUBLIC_CHAIN_ID`, `NEXT_PUBLIC_RPC_URL`, `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID`, `NEXT_PUBLIC_DEV_WALLET=false` for Production and Preview separately. Add the API's public origin to `APP_ORIGINS` on the API.

## Mainnet gate (all required)

1. Independent audit of all contracts, findings resolved.
2. Verified ETH/USD (and USDG/USD) feeds; fork tests against real USDG.
3. Multisig + timelock ownership accepted on-chain.
4. Dedicated RPC, monitoring and alerting live (`infrastructure/monitoring`).
5. Controlled-value pilot with capped amounts.
