import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:4100";

const config: NextConfig = {
  reactStrictMode: true,
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
