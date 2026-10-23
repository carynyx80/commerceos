# Robinhood Chain verification

Read-only checks run on 2026-10-22 against `https://rpc.mainnet.chain.robinhood.com`:

| Check | Result |
|---|---|
| `eth_chainId` | **4663** ✔ |
| Head block | 95,320,211 (RPC responding) |
| USDG `0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168` code | present (170-byte proxy) |
| `name()` / `symbol()` | "Global Dollar" / "USDG" ✔ |
| `decimals()` | **6** ✔ (matches `ASSET_DECIMALS.USDG`) |
| `totalSupply()` | 696,804,204.966175 USDG |
| EIP-1967 implementation slot | `0x68184c449e1a8f34fa18d289737129fd27b66f8f` — **upgradeable proxy** |
| Explorer | `https://robinhoodchain.blockscout.com` (viem chain definition) |

Implications:

- USDG is upgradeable and issuer-controlled (it can freeze/blocklist). The escrow never reverts a settlement on a failed token transfer; it credits `owed[]` instead. Re-verify the implementation address before each deploy.
- Testnet (46630) has no Paxos USDG; deployments there use the labelled no-value `TestUSDG`.

## BNB Chain

Read-only checks run on 2026-10-22 against `https://bsc-dataseed.bnbchain.org`:

| Check | Result |
|---|---|
| `eth_chainId` | **56** ✔ (testnet `data-seed-prebsc-1-s1` returns **97** ✔) |
| USDC `0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d` | "USD Coin" / "USDC", **18 decimals**, supply ≈ 1,589,000,000 |
| USDC EIP-1967 implementation slot | `0xba5fe23f8a3a24bed3236f05f2fcf35fd0bf0b5c` — **upgradeable proxy** (Binance-Peg) |
| Chainlink BNB/USD `0x0567F2323251f0Aab15c8dFb1967E4e8A7D42aeE` | "BNB / USD", 8 decimals, $729.05, updated within the minute |

Implications:

- BNB Chain USDC has **18 decimals**, unlike USDG (6) and Ethereum USDC (6). Checkout scales by the deployment's recorded `stableDecimals`, and `AgentPolicyModule` reads the token's decimals at deployment; both are covered by tests with an 18-decimal token.
- It is a bridged (Binance-Peg) token behind an upgradeable proxy; treat issuer/bridge risk like USDG's.
- The BNB/USD feed above is the one to pass as `NATIVE_USD_FEED` when deploying to 56.

## Not yet verified

- **ETH/USD price feed** on 4663 — no feed address has been verified; the deploy script refuses mainnet without `NATIVE_USD_FEED`.
- **Test USDC on BSC testnet (97)** — not checked; deployments there use the labelled no-value `TestStable` (18 decimals).
- BNB Chain reorg depth: the indexer waits 15 confirmations on 56/97 by default (`CONFIRMATIONS` overrides).
- **ERC-4337** EntryPoint/bundler/paymaster availability — not verified; autonomous payments use the non-4337 AgentAccount design instead.
- `transfer`/`transferFrom` behaviour of the current USDG implementation under blocklisting — to be checked on a fork before mainnet (`anvil --fork-url …`).
- RPC reliability and rate limits of the public endpoint — use a dedicated provider in production.
