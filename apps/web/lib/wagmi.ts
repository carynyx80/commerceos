import { http, createConfig, injected, mock, type CreateConnectorFn } from "wagmi";
import { walletConnect } from "wagmi/connectors";
import { chainById } from "@commerce-os/blockchain";

export const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
export const chain = chainById(CHAIN_ID);
const rpc = process.env.NEXT_PUBLIC_RPC_URL || chain.rpcUrls.default.http[0];

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
export const DEV_WALLET = CHAIN_ID === 31337 && process.env.NEXT_PUBLIC_DEV_WALLET !== "false";
if (DEV_WALLET) {
  connectors.push(
    mock({
      accounts: ["0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC", "0x90F79bf6EB2c4f870365E785982E1f101E93b906", "0x15d34AAf54267DB7D7c367839AAf71A00a2C6A65"],
      features: { reconnect: true },
    }),
  );
}

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(rpc) },
  ssr: true,
});

export const walletConnectEnabled = Boolean(wcProjectId);
