"use client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { createSiweMessage } from "viem/siwe";
import { useAccount, useDisconnect, useSignMessage } from "wagmi";
import { api, ApiError } from "@/lib/api";
import type { Me } from "@/lib/types";
import { CHAIN_ID } from "@/lib/wagmi";

interface SessionCtx {
  me: Me | null;
  loading: boolean;
  apiDown: boolean;
  signingIn: boolean;
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  refresh: () => void;
}
const Ctx = createContext<SessionCtx | null>(null);
export function useSession() {
  const c = useContext(Ctx);
  if (!c) throw new Error("useSession outside provider");
  return c;
}

export function SessionProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const { address, isConnected } = useAccount();
  const { signMessageAsync } = useSignMessage();
  const { disconnect } = useDisconnect();
  const [signingIn, setSigningIn] = useState(false);

  const q = useQuery({
    queryKey: ["me"],
    queryFn: async () => {
      try {
        return await api<Me>("/auth/me");
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    retry: false,
    refetchOnWindowFocus: true,
  });
  const me = q.data ?? null;

  const signIn = useCallback(async () => {
    if (!address) throw new Error("Connect a wallet first.");
    setSigningIn(true);
    try {
      const { nonce } = await api<{ nonce: string }>("/auth/nonce", { method: "POST", json: {} });
      const message = createSiweMessage({
        address,
        chainId: CHAIN_ID,
        domain: window.location.host,
        uri: window.location.origin,
        nonce,
        version: "1",
        statement: "Sign in to Commerce OS. This request will not trigger a transaction or cost gas.",
        issuedAt: new Date(),
        expirationTime: new Date(Date.now() + 10 * 60_000),
      });
      const signature = await signMessageAsync({ message });
      await api("/auth/verify", { json: { message, signature } });
      await qc.invalidateQueries();
    } finally {
      setSigningIn(false);
    }
  }, [address, signMessageAsync, qc]);

  const signOut = useCallback(async () => {
    try {
      await api("/auth/logout", { method: "POST", json: {} });
    } catch {
      /* session may already be gone */
    }
    disconnect();
    qc.setQueryData(["me"], null);
    await qc.invalidateQueries();
  }, [disconnect, qc]);

  // A session is bound to one wallet: switching accounts in the wallet ends it.
  const prev = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (me && isConnected && address && address.toLowerCase() !== me.address.toLowerCase()) {
      void api("/auth/logout", { method: "POST", json: {} }).finally(() => qc.setQueryData(["me"], null));
    }
    prev.current = address;
  }, [address, isConnected, me, qc]);

  return (
    <Ctx.Provider
      value={{
        me,
        loading: q.isLoading,
        apiDown: q.isError,
        signingIn,
        signIn,
        signOut,
        refresh: () => void q.refetch(),
      }}
    >
      {children}
    </Ctx.Provider>
  );
}
