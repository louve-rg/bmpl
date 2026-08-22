-- Addresses a customer keeps, so they do not re-type them and re-pin them for
-- every order. Holds the text AND the coordinate: in Belize the two carry
-- different information and neither can be derived from the other.
CREATE TABLE "saved_addresses" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT,
    "company" TEXT,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "district" "District" NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'BZ',
    "instructions" TEXT,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "saved_addresses_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "saved_addresses_userId_isDefault_idx" ON "saved_addresses"("userId", "isDefault");

ALTER TABLE "saved_addresses" ADD CONSTRAINT "saved_addresses_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
