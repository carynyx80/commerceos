import type { NextConfig } from "next";
import path from "node:path";

const onVercel = process.env.VERCEL === "1";

// The API (NestJS) and worker run on long-lived hosts; Vercel serves only this web app and proxies /api.
const API_URL = process.env.API_URL ?? "http://127.0.0.1:4100";
if (onVercel && !process.env.API_URL) {
  console.warn("[commerce-os] API_URL is not set: /api calls will fail and pages will show 'API unreachable' until it points at the deployed API.");
}

// On Vercel, default to the public testnets rather than the local devnets.
const chainEnv = {
  NEXT_PUBLIC_CHAIN_ID: process.env.NEXT_PUBLIC_CHAIN_ID ?? (onVercel ? "46630" : "31337"),
  NEXT_PUBLIC_BNB_CHAIN_ID: process.env.NEXT_PUBLIC_BNB_CHAIN_ID ?? (onVercel ? "97" : ""),
};

const config: NextConfig = {
  reactStrictMode: true,
  env: chainEnv,
  // Monorepo: trace workspace packages from the repository root.
  outputFileTracingRoot: path.join(__dirname, "../.."),
  transpilePackages: ["@commerce-os/shared", "@commerce-os/blockchain"],
  // Browser calls /api/* on the same origin so the session cookie stays first-party (SameSite=Lax + CSRF header).
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
  // Wallet SDKs reference optional peer modules (React Native storage, pretty loggers, x402) we never use.
  webpack(config, { webpack }) {
    config.plugins.push(new webpack.IgnorePlugin({ resourceRegExp: /^(@x402\/|pino-pretty$|@react-native-async-storage\/async-storage$)/ }));
    // Only the injected and WalletConnect connectors are used; drop the other SDKs from the bundle.
    for (const m of ["@base-org/account", "@coinbase/wallet-sdk", "cbw-sdk", "porto", "porto/internal", "@gemini-wallet/core", "@metamask/sdk", "@safe-global/safe-apps-sdk", "@safe-global/safe-apps-provider"]) {
      config.resolve.alias[m] = false;
    }
    return config;
  },
  images: { remotePatterns: [{ protocol: "https", hostname: "images.unsplash.com" }] },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },
};
export default config;
