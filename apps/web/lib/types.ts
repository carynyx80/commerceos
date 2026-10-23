import type { OrderState } from "@commerce-os/shared";

export interface StoreSummary {
  id: string;
  slug: string;
  name: string;
  tagline: string;
  logoUrl: string | null;
  bannerUrl: string | null;
  verified: boolean;
  isFixture: boolean;
}

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  category: string;
  priceCents: number;
  images: string[];
  acceptedAssets: ("USDG" | "ETH")[];
  negotiable: boolean;
  deliveryType: "PHYSICAL" | "DIGITAL";
  available: number;
  isFixture: boolean;
  featured: boolean;
  createdAt: string;
  store: StoreSummary;
  rating: { average: number; count: number } | null;
}

export interface ProductDetail extends ProductCard {
  description: string;
  specs: Record<string, string>;
  shippingInfo: string;
  reviews: { id: string; rating: number; body: string; createdAt: string; author: string }[];
  store: StoreSummary & { returnPolicy: string; description: string; payoutAddress: string };
}

export interface Me {
  id: string;
  address: string;
  role: "USER" | "ADMIN";
  displayName: string | null;
  chainId: number;
  merchant: { id: string; verified: boolean; stores: StoreSummary[] } | null;
  csrfToken: string;
}

export interface OrderView {
  id: string;
  onchainId: string;
  state: OrderState;
  quantity: number;
  unitCents: number;
  totalCents: number;
  feeBps: number;
  asset: "USDG" | "ETH";
  amount: string;
  buyerAddress: string;
  sellerAddress: string;
  paymentDeadline: string;
  createdAt: string;
  trackingInfo: string | null;
  product: { id: string; title: string; images: string[]; deliveryType: string };
  store: { id: string; slug: string; name: string };
  payments: { txHash: string; status: string; chainId: number }[];
  transitions: { from: string; to: string; source: string; txHash: string | null; createdAt: string }[];
  dispute: { id: string; status: string; reason: string } | null;
  byAgent: boolean;
}
