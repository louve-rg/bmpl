-- Passenger transportation: the foundation, and only the foundation.
--
-- WHAT WAS ABSENT. BML moves parcels; it had no way to move PEOPLE. The
-- PASSENGER_DRIVER and PASSENGER_PROVIDER role codes have existed since the
-- role system shipped, but nothing stood behind them: no profile, no vehicle,
-- no route, no trip. The product owner has now authorized passenger
-- transportation, and this migration gives it a durable shape.
--
-- WHY THIS SHAPE. One set of tables serves BOTH kinds of passenger work: an
-- on-demand point-to-point trip (a taxi) and a scheduled service (a bus or
-- water-taxi run). A trip is one vehicle movement; a booking is one rider's
-- claim on it; an assignment row is the append-only record of who was asked to
-- drive it. A route is operator-configured geography, endpoints as district +
-- town exactly like a courier lane, because which towns a service connects is
-- a fact about Belize entered by an operator - never derived, never invented.
--
-- WHAT WAS REJECTED. Overloading DriverProfile / DriverVehicle: those are
-- wired into delivery dispatch, the driver queue and the self-delivery
-- invariant, and carrying passengers is a different job - possibly held by the
-- same human, which is why both profile kinds hang off the same User. A second
-- role-approval pipeline: the existing RoleApplication machinery already
-- moderates who may drive; nothing here duplicates it. Extending the delivery
-- VehicleType enum: BUS and BOAT mean nothing to parcels, BICYCLE means
-- nothing to fare-paying riders, so passenger vehicles get their own
-- vocabulary rather than coupling the two domains' exhaustive switches.
--
-- NO MONEY MOVES. Fare columns are nullable BIGINT minor units with no
-- default: NULL means "no pricing policy exists yet". No formula, no rate, no
-- wallet linkage, no cancellation fee. Pricing is the product owner's open
-- decision, and the schema only leaves it somewhere to land.
--
-- WHAT DOES NOT CHANGE. Every existing table and every delivery/shipping
-- behaviour. All tables ship EMPTY - real operators, vehicles and routes are
-- business configuration, not seed data. The test/real boundary is symmetric
-- from day one: everything operational carries isTest, admin-set or derived,
-- never taken from a request.

-- CreateEnum
CREATE TYPE "PassengerVehicleType" AS ENUM ('CAR', 'SUV', 'VAN', 'MINIBUS', 'BUS', 'BOAT', 'MOTORCYCLE', 'OTHER');

-- CreateEnum
CREATE TYPE "PassengerTripKind" AS ENUM ('ON_DEMAND', 'SCHEDULED');

-- CreateEnum
CREATE TYPE "PassengerTripStatus" AS ENUM ('SCHEDULED', 'PENDING_ASSIGNMENT', 'ASSIGNED', 'EN_ROUTE_TO_PICKUP', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'EXCEPTION');

-- CreateEnum
CREATE TYPE "PassengerBookingStatus" AS ENUM ('REQUESTED', 'CONFIRMED', 'COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED');

-- CreateEnum
CREATE TYPE "PassengerCancellationParty" AS ENUM ('PASSENGER', 'DRIVER', 'PROVIDER', 'ADMIN', 'SYSTEM');

-- Admin oversight goes in the same audit trail as every other privileged act:
-- configuring a route, moderating a vehicle, cancelling a trip, and flipping
-- the admin-set-only test flags.
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_ROUTE_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_ROUTE_UPDATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_VEHICLE_APPROVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_VEHICLE_REJECTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_TRIP_CANCELLED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_DRIVER_TEST_MODE_CHANGED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'PASSENGER_PROVIDER_TEST_MODE_CHANGED';

-- CreateTable
CREATE TABLE "passenger_driver_profiles" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "providerProfileId" TEXT,
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
    "termsAcceptedAt" TIMESTAMP(3),
    "applicantNotes" TEXT,
    "profilePhotoKey" TEXT,
    "availability" "DriverAvailability" NOT NULL DEFAULT 'OFFLINE',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "ratingAverage" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "completedTrips" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_driver_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_provider_profiles" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "userId" TEXT NOT NULL,
    "businessName" TEXT NOT NULL,
    "description" TEXT,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "district" "District",
    "city" TEXT,
    "addressLine1" TEXT,
    "logoKey" TEXT,
    "operatingLicenceNumber" TEXT,
    "operatingLicenceExpiry" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_provider_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_vehicles" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "providerProfileId" TEXT,
    "ownerDriverProfileId" TEXT,
    "type" "PassengerVehicleType" NOT NULL,
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
    "seatCapacity" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "approvalStatus" "VehicleApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_vehicles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_routes" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "providerProfileId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "originDistrict" "District" NOT NULL,
    "originCity" TEXT NOT NULL,
    "destinationDistrict" "District" NOT NULL,
    "destinationCity" TEXT NOT NULL,
    "scheduleNote" TEXT,
    "durationMinutes" INTEGER,
    "baseFareMinor" BIGINT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_routes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_route_stops" (
    "id" TEXT NOT NULL,
    "routeId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "district" "District" NOT NULL,
    "city" TEXT NOT NULL,
    "name" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_route_stops_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_trips" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "kind" "PassengerTripKind" NOT NULL,
    "status" "PassengerTripStatus" NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "routeId" TEXT,
    "providerProfileId" TEXT,
    "driverProfileId" TEXT,
    "vehicleId" TEXT,
    "seatCapacity" INTEGER,
    "scheduledDepartureAt" TIMESTAMP(3),
    "scheduledArrivalAt" TIMESTAMP(3),
    "originDistrict" "District",
    "originCity" TEXT,
    "originAddress" TEXT,
    "originLatitude" DOUBLE PRECISION,
    "originLongitude" DOUBLE PRECISION,
    "destinationDistrict" "District",
    "destinationCity" TEXT,
    "destinationAddress" TEXT,
    "destinationLatitude" DOUBLE PRECISION,
    "destinationLongitude" DOUBLE PRECISION,
    "assignedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "PassengerCancellationParty",
    "cancellationReason" TEXT,
    "exceptionAt" TIMESTAMP(3),
    "exceptionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_trips_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_bookings" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "passengerUserId" TEXT,
    "tripId" TEXT,
    "seats" INTEGER NOT NULL DEFAULT 1,
    "status" "PassengerBookingStatus" NOT NULL DEFAULT 'REQUESTED',
    "requestedDepartureAt" TIMESTAMP(3),
    "pickupDistrict" "District",
    "pickupCity" TEXT,
    "pickupAddress" TEXT,
    "pickupLatitude" DOUBLE PRECISION,
    "pickupLongitude" DOUBLE PRECISION,
    "dropoffDistrict" "District",
    "dropoffCity" TEXT,
    "dropoffAddress" TEXT,
    "dropoffLatitude" DOUBLE PRECISION,
    "dropoffLongitude" DOUBLE PRECISION,
    "fareQuotedMinor" BIGINT,
    "fareBasis" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "cancelledBy" "PassengerCancellationParty",
    "cancellationReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "passenger_bookings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "passenger_trip_assignments" (
    "id" TEXT NOT NULL,
    "tripId" TEXT NOT NULL,
    "driverProfileId" TEXT NOT NULL,
    "vehicleId" TEXT,
    "assignedByUserId" TEXT,
    "status" "DeliveryAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "respondedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "declineReason" TEXT,
    "endReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "passenger_trip_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "passenger_driver_profiles_userId_key" ON "passenger_driver_profiles"("userId");

-- CreateIndex
CREATE INDEX "passenger_driver_profiles_availability_idx" ON "passenger_driver_profiles"("availability");

-- CreateIndex
CREATE INDEX "passenger_driver_profiles_providerProfileId_idx" ON "passenger_driver_profiles"("providerProfileId");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_provider_profiles_userId_key" ON "passenger_provider_profiles"("userId");

-- CreateIndex
CREATE INDEX "passenger_provider_profiles_isTest_isActive_idx" ON "passenger_provider_profiles"("isTest", "isActive");

-- CreateIndex
CREATE INDEX "passenger_vehicles_providerProfileId_idx" ON "passenger_vehicles"("providerProfileId");

-- CreateIndex
CREATE INDEX "passenger_vehicles_ownerDriverProfileId_idx" ON "passenger_vehicles"("ownerDriverProfileId");

-- CreateIndex
CREATE INDEX "passenger_vehicles_approvalStatus_idx" ON "passenger_vehicles"("approvalStatus");

-- CreateIndex
CREATE INDEX "passenger_routes_isTest_isActive_idx" ON "passenger_routes"("isTest", "isActive");

-- CreateIndex
CREATE INDEX "passenger_routes_providerProfileId_idx" ON "passenger_routes"("providerProfileId");

-- CreateIndex
CREATE INDEX "passenger_routes_originDistrict_originCity_idx" ON "passenger_routes"("originDistrict", "originCity");

-- CreateIndex
CREATE INDEX "passenger_routes_destinationDistrict_destinationCity_idx" ON "passenger_routes"("destinationDistrict", "destinationCity");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_route_stops_routeId_sequence_key" ON "passenger_route_stops"("routeId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_trips_reference_key" ON "passenger_trips"("reference");

-- CreateIndex
CREATE INDEX "passenger_trips_status_isTest_idx" ON "passenger_trips"("status", "isTest");

-- CreateIndex
CREATE INDEX "passenger_trips_routeId_scheduledDepartureAt_idx" ON "passenger_trips"("routeId", "scheduledDepartureAt");

-- CreateIndex
CREATE INDEX "passenger_trips_driverProfileId_status_idx" ON "passenger_trips"("driverProfileId", "status");

-- CreateIndex
CREATE INDEX "passenger_trips_providerProfileId_status_idx" ON "passenger_trips"("providerProfileId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "passenger_bookings_reference_key" ON "passenger_bookings"("reference");

-- CreateIndex
CREATE INDEX "passenger_bookings_passengerUserId_createdAt_idx" ON "passenger_bookings"("passengerUserId", "createdAt");

-- CreateIndex
CREATE INDEX "passenger_bookings_tripId_status_idx" ON "passenger_bookings"("tripId", "status");

-- CreateIndex
CREATE INDEX "passenger_bookings_status_isTest_idx" ON "passenger_bookings"("status", "isTest");

-- CreateIndex
CREATE INDEX "passenger_trip_assignments_tripId_assignedAt_idx" ON "passenger_trip_assignments"("tripId", "assignedAt");

-- CreateIndex
CREATE INDEX "passenger_trip_assignments_driverProfileId_status_idx" ON "passenger_trip_assignments"("driverProfileId", "status");

-- AddForeignKey
ALTER TABLE "passenger_driver_profiles" ADD CONSTRAINT "passenger_driver_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_driver_profiles" ADD CONSTRAINT "passenger_driver_profiles_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "passenger_provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_provider_profiles" ADD CONSTRAINT "passenger_provider_profiles_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_vehicles" ADD CONSTRAINT "passenger_vehicles_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "passenger_provider_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_vehicles" ADD CONSTRAINT "passenger_vehicles_ownerDriverProfileId_fkey" FOREIGN KEY ("ownerDriverProfileId") REFERENCES "passenger_driver_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_routes" ADD CONSTRAINT "passenger_routes_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "passenger_provider_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_route_stops" ADD CONSTRAINT "passenger_route_stops_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "passenger_routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trips" ADD CONSTRAINT "passenger_trips_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "passenger_routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trips" ADD CONSTRAINT "passenger_trips_providerProfileId_fkey" FOREIGN KEY ("providerProfileId") REFERENCES "passenger_provider_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trips" ADD CONSTRAINT "passenger_trips_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "passenger_driver_profiles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trips" ADD CONSTRAINT "passenger_trips_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "passenger_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_bookings" ADD CONSTRAINT "passenger_bookings_passengerUserId_fkey" FOREIGN KEY ("passengerUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_bookings" ADD CONSTRAINT "passenger_bookings_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "passenger_trips"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trip_assignments" ADD CONSTRAINT "passenger_trip_assignments_tripId_fkey" FOREIGN KEY ("tripId") REFERENCES "passenger_trips"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trip_assignments" ADD CONSTRAINT "passenger_trip_assignments_driverProfileId_fkey" FOREIGN KEY ("driverProfileId") REFERENCES "passenger_driver_profiles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trip_assignments" ADD CONSTRAINT "passenger_trip_assignments_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "passenger_vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "passenger_trip_assignments" ADD CONSTRAINT "passenger_trip_assignments_assignedByUserId_fkey" FOREIGN KEY ("assignedByUserId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
