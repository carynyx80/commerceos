import { encodeAbiParameters, keccak256, toHex, type Address, type Hex } from "viem";

/** EIP-712 domain/types for CommerceEscrow quotes. Must match the contract exactly. */
export const quoteTypes = {
  Quote: [
    { name: "orderId", type: "bytes32" },
    { name: "buyer", type: "address" },
    { name: "seller", type: "address" },
    { name: "token", type: "address" },
    { name: "amount", type: "uint256" },
    { name: "deadline", type: "uint256" },
    { name: "termsHash", type: "bytes32" },
  ],
} as const;

export function escrowDomain(chainId: number, escrow: Address) {
  return { name: "CommerceOS Escrow", version: "1", chainId, verifyingContract: escrow } as const;
}

export interface EscrowQuote {
  orderId: Hex;
  buyer: Address;
  seller: Address;
  token: Address;
  amount: bigint;
  deadline: bigint;
  termsHash: Hex;
}

export const ETH_TOKEN = "0x0000000000000000000000000000000000000000" as const;

/** bytes32 on-chain order id derived from the database order id. */
export const onchainOrderId = (dbId: string): Hex => keccak256(toHex(`commerce-os:order:${dbId}`));

/** Hash of the commercial terms the buyer agreed to. Stored on-chain with the escrow. */
export function termsHash(t: { orderId: string; productId: string; storeId: string; quantity: number; unitCents: number; totalCents: number; asset: string; negotiationId?: string | null }): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "string" }, { type: "string" }, { type: "string" }, { type: "uint256" }, { type: "uint256" }, { type: "uint256" }, { type: "string" }, { type: "string" }],
      [t.orderId, t.productId, t.storeId, BigInt(t.quantity), BigInt(t.unitCents), BigInt(t.totalCents), t.asset, t.negotiationId ?? ""],
    ),
  );
}
