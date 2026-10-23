"use client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MotionConfig } from "motion/react";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { SessionProvider } from "./session";
import { CartProvider } from "./cart";
import { Toaster } from "./toast";

export function Providers({ children }: { children: ReactNode }) {
  const [qc] = useState(() => new QueryClient({ defaultOptions: { queries: { staleTime: 15_000, retry: 1 } } }));
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={qc}>
        <MotionConfig reducedMotion="user">
          <Toaster>
            <SessionProvider>
              <CartProvider>{children}</CartProvider>
            </SessionProvider>
          </Toaster>
        </MotionConfig>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
