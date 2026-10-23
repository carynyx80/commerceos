import { z } from "zod";

export const address = z.string().regex(/^0x[a-fA-F0-9]{40}$/, "invalid address");
export const slug = z
  .string()
  .min(3)
  .max(48)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, numbers and dashes");
export const asset = z.enum(["USDG", "ETH", "USDC", "BNB"]);
/** https image URL, or a file uploaded to Commerce OS media storage. */
export const imageRef = z
  .string()
  .max(500)
  .refine((v) => /^\/api\/uploads\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(v) || /^https:\/\/[^\s]+$/.test(v), "must be an https URL or an uploaded image");

export const createStoreSchema = z.object({
  name: z.string().trim().min(2).max(80),
  slug,
  tagline: z.string().trim().max(140).optional().default(""),
  description: z.string().trim().max(4000).optional().default(""),
  payoutAddress: address,
  logoUrl: imageRef.optional().nullable(),
  bannerUrl: imageRef.optional().nullable(),
  returnPolicy: z.string().trim().max(2000).optional().default(""),
});
export type CreateStoreInput = z.infer<typeof createStoreSchema>;
export const updateStoreSchema = createStoreSchema.partial().omit({ slug: true });

export const productSchema = z.object({
  title: z.string().trim().min(2).max(120),
  description: z.string().trim().max(8000).default(""),
  category: z.string().trim().min(2).max(40),
  priceCents: z.number().int().min(100).max(10_000_000),
  inventory: z.number().int().min(0).max(1_000_000),
  images: z.array(imageRef).max(8).default([]),
  specs: z.record(z.string().max(60), z.string().max(200)).default({}),
  acceptedAssets: z.array(asset).min(1).default(["USDG", "ETH", "USDC", "BNB"]),
  deliveryType: z.enum(["PHYSICAL", "DIGITAL"]).default("PHYSICAL"),
  shippingInfo: z.string().max(500).default(""),
  negotiable: z.boolean().default(false),
  /** Lowest price the seller agent may accept, in cents. Never exposed to buyers. */
  floorPriceCents: z.number().int().min(0).optional().nullable(),
  status: z.enum(["DRAFT", "ACTIVE", "ARCHIVED"]).default("ACTIVE"),
});
export type ProductInput = z.infer<typeof productSchema>;

export const searchSchema = z.object({
  q: z.string().max(200).optional(),
  category: z.string().max(40).optional(),
  store: z.string().max(48).optional(),
  minPrice: z.coerce.number().int().min(0).optional(),
  maxPrice: z.coerce.number().int().min(0).optional(),
  asset: asset.optional(),
  negotiable: z.coerce.boolean().optional(),
  inStock: z.coerce.boolean().optional(),
  sort: z.enum(["relevance", "price_asc", "price_desc", "newest"]).default("relevance"),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type SearchInput = z.infer<typeof searchSchema>;

export const cartItemSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
});

export const checkoutSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99),
  asset,
  /** Optional accepted-offer quote; otherwise list price is used. */
  negotiationId: z.string().optional(),
  shipping: z
    .object({
      name: z.string().max(120),
      line1: z.string().max(200),
      line2: z.string().max(200).optional(),
      city: z.string().max(80),
      region: z.string().max(80).optional(),
      postalCode: z.string().max(20),
      country: z.string().max(60),
    })
    .optional(),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

export const agentPolicySchema = z.object({
  maxPerOrderCents: z.number().int().min(100).max(100_000_00),
  rollingLimitCents: z.number().int().min(100).max(1_000_000_00),
  rollingWindowDays: z.number().int().min(1).max(90).default(30),
  allowedAssets: z.array(asset).min(1),
  approvedCategories: z.array(z.string().max(40)).max(30).default([]),
  approvedStoreIds: z.array(z.string()).max(50).default([]),
  expiresAt: z.coerce.date(),
  maxDiscountAskBps: z.number().int().min(0).max(5000).default(1500),
  maxNegotiationRounds: z.number().int().min(1).max(8).default(4),
  automationEnabled: z.boolean().default(false),
});
export type AgentPolicyInput = z.infer<typeof agentPolicySchema>;

export const createAgentSchema = z.object({
  name: z.string().trim().min(2).max(60),
  type: z.enum(["BUYER", "SELLER"]),
  description: z.string().trim().max(500).default(""),
  preferences: z.string().trim().max(2000).default(""),
  storeId: z.string().optional(),
  policy: agentPolicySchema.optional(),
});
export type CreateAgentInput = z.infer<typeof createAgentSchema>;

export const offerSchema = z.object({
  productId: z.string().min(1),
  quantity: z.number().int().min(1).max(99).default(1),
  priceCents: z.number().int().min(1),
  asset,
  message: z.string().max(1000).optional(),
});
export type OfferInput = z.infer<typeof offerSchema>;
