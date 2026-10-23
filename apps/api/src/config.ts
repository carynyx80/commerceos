/** Validated runtime configuration. Missing optional services surface as honest "not configured" states. */
function num(v: string | undefined, d: number) {
  const n = Number(v);
  return Number.isFinite(n) && v !== undefined && v !== "" ? n : d;
}

export const config = {
  port: num(process.env.PORT, 4100),
  env: process.env.NODE_ENV ?? "development",
  chainId: num(process.env.CHAIN_ID, 31337),
  rpcUrl: process.env.RPC_URL ?? "",
  /** Origins allowed to sign in (SIWE domain) and to make credentialed requests. */
  appOrigins: (process.env.APP_ORIGINS ?? "http://localhost:3100,http://127.0.0.1:3100").split(",").map((s) => s.trim()),
  sessionTtlHours: num(process.env.SESSION_TTL_HOURS, 24 * 7),
  cookieSecure: process.env.COOKIE_SECURE === "true" || process.env.NODE_ENV === "production",
  /** Private key that signs checkout quotes (EIP-712). Must match the escrow's quoteSigner. */
  quoteSignerKey: process.env.QUOTE_SIGNER_PRIVATE_KEY ?? "",
  quoteTtlSeconds: num(process.env.QUOTE_TTL_SECONDS, 15 * 60),
  /** Comma-separated wallet addresses granted ADMIN at sign-in. */
  adminAddresses: (process.env.ADMIN_ADDRESSES ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  openaiConfigured: Boolean(process.env.OPENAI_API_KEY),
};
