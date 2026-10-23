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

## Not yet verified

- **ETH/USD price feed** on 4663 — no feed address has been verified; the deploy script refuses mainnet without `ETH_USD_FEED`.
- **ERC-4337** EntryPoint/bundler/paymaster availability — not verified; autonomous payments use the non-4337 AgentAccount design instead.
- `transfer`/`transferFrom` behaviour of the current USDG implementation under blocklisting — to be checked on a fork before mainnet (`anvil --fork-url …`).
- RPC reliability and rate limits of the public endpoint — use a dedicated provider in production.
