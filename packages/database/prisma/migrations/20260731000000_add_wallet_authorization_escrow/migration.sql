-- Wallet authorization & escrow (Phase 3 · M12) — first real money movement.
-- Adds wallet-account status, wallet-hold AUTHORIZED + escrow tx link, order
-- cancellation, and audit actions. (Search-index DROPs from auto-diff omitted.)

-- CreateEnum
CREATE TYPE "WalletAccountStatus" AS ENUM ('ACTIVE', 'LOCKED', 'SUSPENDED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_AUTHORIZED';
ALTER TYPE "AuditAction" ADD VALUE 'PAYMENT_AUTHORIZATION_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'WALLET_VALIDATION_FAILED';
ALTER TYPE "AuditAction" ADD VALUE 'ESCROW_FUNDS_HELD';
ALTER TYPE "AuditAction" ADD VALUE 'ESCROW_FUNDS_RELEASED';
ALTER TYPE "AuditAction" ADD VALUE 'WALLET_TRANSACTION_POSTED';

-- AlterEnum
ALTER TYPE "OrderStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "VendorOrderStatus" ADD VALUE 'CANCELLED';

-- AlterEnum
ALTER TYPE "WalletHoldStatus" ADD VALUE 'AUTHORIZED';



-- AlterTable
ALTER TABLE "wallet_accounts" ADD COLUMN     "status" "WalletAccountStatus" NOT NULL DEFAULT 'ACTIVE';

-- AlterTable
ALTER TABLE "wallet_holds" ADD COLUMN     "authorizedAt" TIMESTAMP(3),
ADD COLUMN     "walletTransactionId" TEXT;

