import { http, createConfig, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
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

export const wagmiConfig = createConfig({
  chains: [chain],
  connectors,
  transports: { [chain.id]: http(rpc) },
  ssr: true,
});

export const walletConnectEnabled = Boolean(wcProjectId);
