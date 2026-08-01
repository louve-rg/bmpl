-- CreateEnum
CREATE TYPE "DriverEarningMethod" AS ENUM ('FLAT', 'PERCENT_DELIVERY_FEE', 'HYBRID');

-- CreateEnum
CREATE TYPE "SettlementStatus" AS ENUM ('PENDING', 'POSTED', 'FAILED');

-- CreateTable
CREATE TABLE "platform_fee_configs" (
    "id" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "currency" "Currency" NOT NULL DEFAULT 'BZD',
    "commissionBps" INTEGER NOT NULL DEFAULT 1000,
    "driverEarningMethod" "DriverEarningMethod" NOT NULL DEFAULT 'PERCENT_DELIVERY_FEE',
    "driverFlatMinor" BIGINT NOT NULL DEFAULT 0,
    "driverDeliveryFeeBps" INTEGER NOT NULL DEFAULT 8000,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "platform_fee_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "vendor_settlements" (
    "id" TEXT NOT NULL,
    "vendorProfileId" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'BZD',
    "merchandiseSubtotalMinor" BIGINT NOT NULL,
    "deliveryFeeMinor" BIGINT NOT NULL,
    "commissionMinor" BIGINT NOT NULL,
    "driverAllocationMinor" BIGINT NOT NULL,
    "platformFeeMinor" BIGINT NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "netMinor" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "snapshot" JSONB NOT NULL,
    "walletTransactionId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "vendor_settlements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_earnings" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "orderDeliveryId" TEXT NOT NULL,
    "vendorOrderId" TEXT NOT NULL,
    "settlementId" TEXT,
    "currency" "Currency" NOT NULL DEFAULT 'BZD',
    "method" "DriverEarningMethod" NOT NULL,
    "grossMinor" BIGINT NOT NULL,
    "adjustmentsMinor" BIGINT NOT NULL DEFAULT 0,
    "netMinor" BIGINT NOT NULL,
    "status" "SettlementStatus" NOT NULL DEFAULT 'PENDING',
    "snapshot" JSONB NOT NULL,
    "walletTransactionId" TEXT,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "postedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "platform_fee_configs_isActive_idx" ON "platform_fee_configs"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "vendor_settlements_vendorOrderId_key" ON "vendor_settlements"("vendorOrderId");

-- CreateIndex
CREATE INDEX "vendor_settlements_vendorProfileId_status_idx" ON "vendor_settlements"("vendorProfileId", "status");

-- CreateIndex
CREATE INDEX "vendor_settlements_paymentId_idx" ON "vendor_settlements"("paymentId");

-- CreateIndex
CREATE INDEX "vendor_settlements_status_idx" ON "vendor_settlements"("status");

-- CreateIndex
CREATE UNIQUE INDEX "driver_earnings_orderDeliveryId_key" ON "driver_earnings"("orderDeliveryId");

-- CreateIndex
CREATE INDEX "driver_earnings_driverProfileId_status_idx" ON "driver_earnings"("driverProfileId", "status");

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_vendorProfileId_fkey" FOREIGN KEY ("vendorProfileId") REFERENCES "vendor_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_vendorOrderId_fkey" FOREIGN KEY ("vendorOrderId") REFERENCES "vendor_orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "vendor_settlements" ADD CONSTRAINT "vendor_settlements_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_orderDeliveryId_fkey" FOREIGN KEY ("orderDeliveryId") REFERENCES "order_deliveries"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "driver_earnings" ADD CONSTRAINT "driver_earnings_settlementId_fkey" FOREIGN KEY ("settlementId") REFERENCES "vendor_settlements"("id") ON DELETE SET NULL ON UPDATE CASCADE;

