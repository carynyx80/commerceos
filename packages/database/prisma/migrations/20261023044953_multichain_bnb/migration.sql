-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "PaymentAssetKind" ADD VALUE 'USDC';
ALTER TYPE "PaymentAssetKind" ADD VALUE 'BNB';

-- Before this migration every order settled on the single Robinhood-family chain. Backfill from the
-- recorded payment chain where one exists; otherwise 31337, the only chain any deployment of this
-- schema had used (local devnet). No row data is deleted.

-- AlterTable
ALTER TABLE "Agent" ADD COLUMN     "accountChainId" INTEGER;
UPDATE "Agent" SET "accountChainId" = 31337 WHERE "accountAddress" IS NOT NULL;

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "chainId" INTEGER;
UPDATE "Order" o SET "chainId" = COALESCE((SELECT p."chainId" FROM "Payment" p WHERE p."orderId" = o.id ORDER BY p."createdAt" LIMIT 1), 31337);
ALTER TABLE "Order" ALTER COLUMN "chainId" SET NOT NULL;

-- AlterTable
ALTER TABLE "CheckoutQuote" ADD COLUMN     "chainId" INTEGER;
UPDATE "CheckoutQuote" q SET "chainId" = COALESCE((SELECT o."chainId" FROM "Order" o WHERE o."quoteId" = q.id), 31337);
ALTER TABLE "CheckoutQuote" ALTER COLUMN "chainId" SET NOT NULL;

-- CreateIndex
CREATE INDEX "Order_chainId_state_idx" ON "Order"("chainId", "state");
