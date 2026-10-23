"use client";
import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useAccount, useBalance, useConnect, useReadContract, useSwitchChain } from "wagmi";
import { erc20Abi } from "viem";
import { deploymentFor } from "@commerce-os/blockchain";
import { formatUnits } from "@commerce-os/shared";
import { CHAIN_ID, chain } from "@/lib/wagmi";
import { shortAddr } from "@/lib/format";
import { useSession } from "../session";
import { useToast } from "../toast";

export function ConnectButton({ compact = false }: { compact?: boolean }) {
  const { address, isConnected, chainId } = useAccount();
  const { connectors, connectAsync, isPending } = useConnect();
  const { switchChainAsync } = useSwitchChain();
  const { me, signIn, signingIn, signOut, apiDown } = useSession();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const wrongChain = isConnected && chainId !== CHAIN_ID;

  async function doSignIn() {
    try {
      await signIn();
      toast({ title: "Signed in", body: "Your wallet signature created a secure session.", tone: "ok" });
    } catch (e: any) {
      toast({ title: "Sign-in failed", body: e?.shortMessage ?? e?.message ?? String(e), tone: "error" });
    }
  }

  if (!isConnected) {
    return (
      <div className="relative" ref={ref}>
        <button className={`btn btn-secondary ${compact ? "btn-sm" : ""}`} onClick={() => setOpen((v) => !v)} disabled={isPending}>
          {isPending ? "Connecting…" : "Connect wallet"}
        </button>
        <AnimatePresence>
          {open && (
            <Dropdown>
              <p className="eyebrow mb-2 px-2">Choose a wallet</p>
              {connectors.length === 0 && <p className="px-2 py-2 text-[13px] text-mist">No wallet found in this browser.</p>}
              {connectors.map((c) => (
                <button
                  key={c.uid}
                  className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-left text-[14px] hover:bg-white/5"
                  onClick={async () => {
                    try {
                      await connectAsync({ connector: c, chainId: CHAIN_ID });
                      setOpen(false);
                    } catch (e: any) {
                      toast({ title: "Wallet not connected", body: e?.shortMessage ?? e?.message, tone: "error" });
                    }
                  }}
                >
                  {c.type === "mock" ? "Local devnet test wallet" : c.name === "Injected" ? "Browser wallet" : c.name}
                  <span className="text-dim">→</span>
                </button>
              ))}
              <p className="mt-2 border-t hairline px-2 pt-2 text-[12px] text-dim">
                Network: {chain.name} ({CHAIN_ID})
              </p>
            </Dropdown>
          )}
        </AnimatePresence>
      </div>
    );
  }

  if (wrongChain) {
    return (
      <button
        className={`btn btn-secondary ${compact ? "btn-sm" : ""} !border-warn/50 !text-warn`}
        onClick={() => switchChainAsync({ chainId: CHAIN_ID }).catch((e) => toast({ title: "Switch failed", body: e?.shortMessage, tone: "error" }))}
      >
        Switch to {chain.name}
      </button>
    );
  }

  if (!me) {
    return (
      <button className={`btn btn-primary ${compact ? "btn-sm" : ""}`} onClick={doSignIn} disabled={signingIn || apiDown} title={apiDown ? "API unavailable" : undefined}>
        {signingIn ? "Check your wallet…" : "Sign in"}
      </button>
    );
  }

  return (
    <div className="relative" ref={ref}>
      <button className={`btn btn-secondary ${compact ? "btn-sm" : ""} num`} onClick={() => setOpen((v) => !v)} aria-haspopup="menu">
        <span className="size-1.5 rounded-full bg-ok" />
        {shortAddr(address)}
      </button>
      <AnimatePresence>
        {open && (
          <Dropdown>
            <Balances address={address!} />
            <nav className="mt-1 flex flex-col border-t hairline pt-1 text-[14px]" onClick={() => setOpen(false)}>
              <MenuLink href="/orders">Orders</MenuLink>
              <MenuLink href="/agents">Agent Studio</MenuLink>
              <MenuLink href="/sell">Seller dashboard</MenuLink>
              <MenuLink href="/saved">Saved</MenuLink>
              <MenuLink href="/notifications">Notifications</MenuLink>
              {me.role === "ADMIN" && <MenuLink href="/admin">Admin console</MenuLink>}
              <button className="rounded-lg px-2 py-2 text-left text-mist hover:bg-white/5 hover:text-porcelain" onClick={() => void signOut()}>
                Sign out
              </button>
            </nav>
          </Dropdown>
        )}
      </AnimatePresence>
    </div>
  );
}

function MenuLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="rounded-lg px-2 py-2 text-mist hover:bg-white/5 hover:text-porcelain">
      {children}
    </Link>
  );
}

function Balances({ address }: { address: `0x${string}` }) {
  const d = deploymentFor(CHAIN_ID);
  const eth = useBalance({ address });
  const usdg = useReadContract({
    address: d?.usdg,
    abi: erc20Abi,
    functionName: "balanceOf",
    args: [address],
    query: { enabled: !!d },
  });
  return (
    <div className="px-2 pb-2">
      <p className="eyebrow mb-2">Wallet balances</p>
      <Row label="ETH" value={eth.data ? formatUnits(eth.data.value, 18, 5) : eth.isError ? "unavailable" : "…"} />
      <Row
        label={d?.testToken ? "USDG (test)" : "USDG"}
        value={!d ? "not deployed" : usdg.data !== undefined ? formatUnits(usdg.data as bigint, 6, 2) : usdg.isError ? "unavailable" : "…"}
      />
    </div>
  );
}
const Row = ({ label, value }: { label: string; value: string }) => (
  <div className="flex items-center justify-between py-1 text-[13px]">
    <span className="text-mist">{label}</span>
    <span className="num">{value}</span>
  </div>
);

function Dropdown({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.16 }}
      className="surface-raised absolute right-0 top-[calc(100%+8px)] z-50 w-64 rounded-2xl bg-obsidian-2/95 p-2 backdrop-blur-xl"
      role="menu"
    >
      {children}
    </motion.div>
  );
}
