import { http, createConfig, injected, mock, type CreateConnectorFn } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import type { Chain } from "viem";
import { chainById, chainForAsset, deploymentFor, NETWORK_OF_CHAIN } from "@commerce-os/blockchain";
import type { PaymentAsset } from "@commerce-os/shared";

/** Robinhood-family chain (USDG + ETH). */
export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const chain = chainById(CHAIN_ID);
/** BNB Chain (USDC + BNB), when enabled. */
export const BNB_CHAIN_ID = process.env.NEXT_PUBLIC_BNB_CHAIN_ID ? Number(process.env.NEXT_PUBLIC_BNB_CHAIN_ID) : null;
export const ENABLED_CHAIN_IDS = [CHAIN_ID, ...(BNB_CHAIN_ID ? [BNB_CHAIN_ID] : [])];
export const enabledChains: Chain[] = ENABLED_CHAIN_IDS.map(chainById);

const rpcFor = (id: number) =>
  (id === CHAIN_ID && process.env.NEXT_PUBLIC_RPC_URL) || (id === BNB_CHAIN_ID && process.env.NEXT_PUBLIC_BNB_RPC_URL) || chainById(id).rpcUrls.default.http[0];

/** Chain an asset settles on in this deployment, or null when its network is off. */
export function chainIdForAsset(asset: PaymentAsset): number | null {
  return chainForAsset(asset, { robinhood: CHAIN_ID, bnb: BNB_CHAIN_ID });
}
/** Assets payable here: the listing's accepted assets whose network is enabled and deployed. */
export function payableAssets(accepted: readonly PaymentAsset[]): PaymentAsset[] {
  return accepted.filter((a) => {
    const id = chainIdForAsset(a);
    return id != null && deploymentFor(id) != null;
  });
}
export const networkOf = (chainId: number) => NETWORK_OF_CHAIN[chainId];

const connectors: CreateConnectorFn[] = [injected({ shimDisconnect: true })];
const wcProjectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID;
if (wcProjectId) {
  connectors.push(
    walletConnect({
      projectId: wcProjectId,
      metadata: {
        name: "Commerce OS",
        description: "The operating system for autonomous commerce.",
        url: process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3100",
        icons: [],
      },
      showQrModal: true,
    }),
  );
}

/**
 * Local devnet only: Anvil's unlocked public dev accounts, so the app can be exercised in a
 * browser without an extension. Never enabled on any public network.
 */
export const DEV_WALLET =
  CHAIN_ID === 31337 &&
  (BNB_CHAIN_ID === null || BNB_CHAIN_ID === 31338) &&
  process.env.NEXT_PUBLIC_DEV_WALLET !== "false" &&
  // never on a deployed site, even if someone points it at a local chain id
  !process.env.NEXT_PUBLIC_VERCEL_ENV;
if (DEV_WALLET) {
  connectors.push(
    mock({
      accounts: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"],
      features: { reconnect: true },
    }),
  );
}

export const wagmiConfig = createConfig({
  chains: enabledChains as [Chain, ...Chain[]],
  connectors,
  transports: Object.fromEntries(ENABLED_CHAIN_IDS.map((id) => [id, http(rpcFor(id))])),
  ssr: true,
});

export const walletConnectEnabled = Boolean(wcProjectId);
