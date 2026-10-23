"use client";
import type { ReactNode } from "react";
import { Lock } from "./icons";
import { useSession } from "./session";
import { ConnectButton } from "./wallet/connect-button";

export function SignInGate({ title, children, admin }: { title: string; children: ReactNode; admin?: boolean }) {
  const { me, loading, apiDown } = useSession();
  if (loading) return <div className="mx-auto max-w-xl px-4 py-32 text-center text-mist">Loading…</div>;
  if (apiDown) return <div className="mx-auto max-w-xl px-4 py-32 text-center text-mist">The Commerce OS API is unreachable right now.</div>;
  if (!me)
    return (
      <div className="mx-auto max-w-xl px-4 py-28 text-center">
        <Lock size={22} className="mx-auto text-champagne" />
        <h1 className="display mt-6 text-[44px]">{title}</h1>
        <p className="mt-3 text-mist">Connect your wallet and sign a message to continue. Signing is free and sends no transaction.</p>
        <div className="mt-8 flex justify-center"><ConnectButton /></div>
      </div>
    );
  if (admin && me.role !== "ADMIN") return <div className="mx-auto max-w-xl px-4 py-32 text-center text-mist">Administrator access required.</div>;
  return <>{children}</>;
}
