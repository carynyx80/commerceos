/**
 * End-to-end helpers. These run against the real stack: API (:4100), worker, Postgres and a
 * local Anvil chain with contracts deployed. Keys below are Anvil's public dev accounts.
 */
import { createPublicClient, createWalletClient, http, type Hex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { createSiweMessage } from "viem/siwe";
import { anvil, deploymentFor } from "@commerce-os/blockchain";

export const API = process.env.E2E_API ?? "http://127.0.0.1:4100";
export const ORIGIN = "http://localhost:3100";
export const KEYS = {
  buyer: "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a", // anvil #2
  buyer2: "0x7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6", // anvil #3
  newSeller: "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a", // anvil #4
  atelierSeller: "0x8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba", // anvil #5 (fixture payout)
  deployer: "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80", // anvil #0
} as const;

export const d = deploymentFor(31337)!;
export const pub = createPublicClient({ chain: anvil, transport: http("http://127.0.0.1:8545") });
export const walletFor = (key: Hex) => createWalletClient({ account: privateKeyToAccount(key), chain: anvil, transport: http("http://127.0.0.1:8545") });

export class Session {
  cookie = "";
  csrf = "";
  constructor(public key: Hex) {}
  get address() {
    return privateKeyToAccount(this.key).address;
  }

  async req<T = any>(path: string, init: { method?: string; json?: unknown } = {}): Promise<{ status: number; body: T }> {
    const method = init.method ?? (init.json !== undefined ? "POST" : "GET");
    const headers: Record<string, string> = { origin: ORIGIN };
    if (init.json !== undefined) headers["content-type"] = "application/json";
    if (this.cookie) headers.cookie = this.cookie;
    if (this.csrf && method !== "GET") headers["x-csrf-token"] = this.csrf;
    const res = await fetch(`${API}${path}`, { method, headers, body: init.json !== undefined ? JSON.stringify(init.json) : undefined });
    const set = res.headers.getSetCookie?.() ?? [];
    for (const c of set) {
      const [kv] = c.split(";");
      const [k, v] = kv.split("=");
      if (k === "cos_session") this.cookie = `cos_session=${v}`;
      if (k === "cos_csrf") this.csrf = decodeURIComponent(v);
    }
    const text = await res.text();
    return { status: res.status, body: text ? JSON.parse(text) : null };
  }

  async signIn() {
    const acct = privateKeyToAccount(this.key);
    const { body } = await this.req<{ nonce: string }>("/auth/nonce", { json: {} });
    const message = createSiweMessage({ address: acct.address, chainId: 31337, domain: "localhost:3100", uri: ORIGIN, nonce: body.nonce, version: "1", issuedAt: new Date() });
    const signature = await acct.signMessage({ message });
    const r = await this.req("/auth/verify", { json: { message, signature } });
    if (r.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(r.body)}`);
    return { message, signature };
  }
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 30_000, what = "condition"): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const v = await fn();
    if (v) return v as T;
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`timed out waiting for ${what}`);
}

export async function orderState(s: Session, id: string) {
  return (await s.req(`/orders/${id}`)).body.state as string;
}
