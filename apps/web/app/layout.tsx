import type { Metadata, Viewport } from "next";
import { Geist_Mono, Instrument_Serif } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/providers";
import { Nav } from "@/components/nav";
import { CartDrawer } from "@/components/cart-drawer";
import { Footer } from "@/components/footer";
import { NetworkBanner } from "@/components/network-banner";

const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-instrument", display: "swap" });

export const metadata: Metadata = {
  title: { default: "Commerce OS — Commerce, without boundaries.", template: "%s · Commerce OS" },
  description: "Buy, sell, and transact through intelligent AI agents. Discover products, negotiate better deals, and settle securely on-chain.",
};
export const viewport: Viewport = { themeColor: "#101817", colorScheme: "dark" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${mono.variable} ${serif.variable}`}>
      <head>
        {/* Satoshi by Indian Type Foundry, served by Fontshare under the ITF Free Font License. */}
        <link rel="preconnect" href="https://api.fontshare.com" crossOrigin="" />
        <link rel="stylesheet" href="https://api.fontshare.com/v2/css?f[]=satoshi@400,500,700&display=swap" />
      </head>
      <body className="overflow-x-hidden">
        <Providers>
          <NetworkBanner />
          <Nav />
          <main>{children}</main>
          <Footer />
          <CartDrawer />
        </Providers>
      </body>
    </html>
  );
}
