-- Phase 4 · M14 — Driver Management Foundation (accounts/profiles/vehicles/service areas; no dispatch).

-- CreateEnum
CREATE TYPE "DriverAvailability" AS ENUM ('OFFLINE', 'ONLINE', 'UNAVAILABLE', 'SUSPENDED');
-- CreateEnum
CREATE TYPE "VehicleType" AS ENUM ('CAR', 'MOTORCYCLE', 'SCOOTER', 'BICYCLE', 'VAN', 'TRUCK', 'OTHER');
-- CreateEnum
CREATE TYPE "VehicleOwnership" AS ENUM ('OWNED', 'LEASED', 'BORROWED', 'NONE');
-- CreateEnum
CREATE TYPE "VehicleApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');
-- CreateTable
CREATE TABLE "driver_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "homeDistrict" "District" NOT NULL,
    "homeAddress" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "emergencyContactName" TEXT,
    "emergencyContactPhone" TEXT,
    "licenceNumber" TEXT NOT NULL,
    "licenceExpiry" TIMESTAMP(3) NOT NULL,
    "vehicleOwnership" "VehicleOwnership" NOT NULL DEFAULT 'OWNED',
    "termsAcceptedAt" TIMESTAMP(3),
    "applicantNotes" TEXT,
    "profilePhotoKey" TEXT,
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedDeliveries" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_profiles_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "driver_vehicles" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "type" "VehicleType" NOT NULL,
    "make" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "year" INTEGER,
    "color" TEXT,
    "licencePlate" TEXT NOT NULL,
    "registrationNumber" TEXT,
    "registrationExpiry" TIMESTAMP(3),
    "insuranceProvider" TEXT,
    "insurancePolicyNumber" TEXT,
    "insuranceExpiry" TIMESTAMP(3),
    "photoKeys" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "VehicleApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_vehicles_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "driver_service_areas" (
    "id" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "driver_service_areas_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "driver_profiles_userId_key" ON "driver_profiles"("userId");
-- CreateIndex
CREATE INDEX "driver_profiles_availability_idx" ON "driver_profiles"("availability");
-- CreateIndex
CREATE INDEX "driver_vehicles_driverProfileId_idx" ON "driver_vehicles"("driverProfileId");
-- CreateIndex
CREATE INDEX "driver_vehicles_approvalStatus_idx" ON "driver_vehicles"("approvalStatus");
-- CreateIndex
CREATE INDEX "driver_service_areas_driverProfileId_idx" ON "driver_service_areas"("driverProfileId");
-- CreateIndex
CREATE UNIQUE INDEX "driver_service_areas_driverProfileId_district_key" ON "driver_service_areas"("driverProfileId", "district");
-- AddForeignKey
ALTER TABLE "driver_profiles" ADD CONSTRAINT "driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "driver_vehicles" ADD CONSTRAINT "driver_vehicles_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "driver_service_areas" ADD CONSTRAINT "driver_service_areas_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
