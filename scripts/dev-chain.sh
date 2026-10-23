#!/usr/bin/env bash
# Boots a local Anvil chain, deploys Commerce OS contracts and generates throwaway dev keys.
# Writes .env.local-chain (gitignored). Local devnet only: never fund these keys elsewhere.
set -euo pipefail
cd "$(dirname "$0")/.."
RPC=http://127.0.0.1:8545
ANVIL0=0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80 # Anvil's public dev key
if ! cast chain-id --rpc-url $RPC >/dev/null 2>&1; then
  anvil --port 8545 --chain-id 31337 --state .anvil-state.json --silent &
  sleep 2
fi
gen() { cast wallet new --json | python3 -c "import sys,json;d=json.load(sys.stdin)['data'][0];print(d['private_key'],d['address'])"; }
if [ ! -f .env.local-chain ]; then
  set -- $(gen) $(gen) $(gen)
  printf "QUOTE_SIGNER_PRIVATE_KEY=$1\nQUOTE_SIGNER=$2\nREGISTRAR_PRIVATE_KEY=$3\nREGISTRAR=$4\nAGENT_EXECUTOR_PRIVATE_KEY=$5\nAGENT_EXECUTOR=$6\n" > .env.local-chain
  chmod 600 .env.local-chain
fi
source ./.env.local-chain
cast send -q --rpc-url $RPC --private-key $ANVIL0 $REGISTRAR --value 10ether
cast send -q --rpc-url $RPC --private-key $ANVIL0 $AGENT_EXECUTOR --value 10ether
(cd contracts && DEPLOYER_PRIVATE_KEY=$ANVIL0 QUOTE_SIGNER=$QUOTE_SIGNER REGISTRAR=$REGISTRAR \
  SEED_MERCHANTS=0x9965507D1a55bcC2695C58ba16FB37d819B0A4dc,0x976EA74026E726554dB657fA54763abd0C3a0aa9,0x14dC79964da2C08b23698B3D3cc7Ca32193d9955,0x23618e81E3f5cdF7f54C3d65f7FBc0aBf5B21E8f,0xa0Ee7A142d267C1f36714E4a8F75612F20a79720 \
  forge script script/Deploy.s.sol --rpc-url $RPC --broadcast >/dev/null)
node scripts/gen-abis.mjs
echo "Deployed. Addresses in packages/blockchain/deployments/31337.json; keys in .env.local-chain."
