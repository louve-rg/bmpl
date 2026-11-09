-- Terminal operations (TERM-1/TERM-3): terminal companies, the hubs they are
-- authorized to work, staff scoped to a company AND a specific location, and
-- a real admin-driven invite flow.
--
-- Additive only. No existing table, column or enum value is touched:
--  - ShippingProviderProfile/ShippingProviderMember are untouched — a
--    terminal operator is a separate org type, not a carrier, even though
--    the membership shape below is intentionally identical to
--    ShippingProviderMember's (TERM-1's recon: that shape is the right
--    precedent, reused on purpose).
--  - LogisticsHub gains one new relation (terminalCompanyLocations) and no
--    column changes.
--  - The existing plaintext pickupPin/handoffPin columns on ShipmentLeg are
--    NOT touched or extended by this migration. Every NEW terminal code
--    this feature introduces is hashed at rest (see tokenHash below); the
--    old columns stay exactly as they are, by owner ruling (real migration
--    risk across live shipments, no feature benefit this batch) — the owner
--    is being told plainly, separately, that those old columns are
--    plaintext.
--  - The handoff-direction reversal itself (courier presents, terminal
--    verifies) is NOT part of this migration. TERM-1 confirmed that is real
--    application logic to invert, not a schema or permission change, and it
--    is deliberately deferred to its own slice once staff and locations
--    exist to verify as.
--
-- Rollback: drop the five new tables (in FK-dependency order: member
-- locations, invites, members, locations, profiles) and the two new enums;
-- the seven new AuditAction values cannot be removed from a live enum
-- (Postgres has no DROP VALUE) but are inert if the feature is rolled back.

-- ---- Company ----------------------------------------------------------------

CREATE TABLE "terminal_company_profiles" (
    "id" TEXT NOT NULL,
    "isTest" BOOLEAN NOT NULL DEFAULT false,
    "businessName" TEXT NOT NULL,
    "contactEmail" TEXT NOT NULL,
    "contactPhone" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_company_profiles_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "terminal_company_profiles_isActive_isTest_idx" ON "terminal_company_profiles" ("isActive", "isTest");

-- ---- Location axis (new shape — nothing in this schema modelled it before) --

CREATE TABLE "terminal_company_locations" (
    "id" TEXT NOT NULL,
    "terminalCompanyId" TEXT NOT NULL,
    "hubId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_company_locations_pkey" PRIMARY KEY ("id")
);

-- One row per (company, hub): re-authorizing a hub reactivates rather than
-- growing a second row for the same pair.
CREATE UNIQUE INDEX "terminal_company_locations_terminalCompanyId_hubId_key" ON "terminal_company_locations" ("terminalCompanyId", "hubId");
CREATE INDEX "terminal_company_locations_hubId_idx" ON "terminal_company_locations" ("hubId");

ALTER TABLE "terminal_company_locations" ADD CONSTRAINT "terminal_company_locations_terminalCompanyId_fkey"
    FOREIGN KEY ("terminalCompanyId") REFERENCES "terminal_company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict, matching every other hub FK in this schema: a hub a terminal
-- company still has location history at cannot be hard-deleted out from
-- under it. Deactivate the hub (LogisticsHub.isActive) instead.
ALTER TABLE "terminal_company_locations" ADD CONSTRAINT "terminal_company_locations_hubId_fkey"
    FOREIGN KEY ("hubId") REFERENCES "logistics_hubs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Membership (company axis — reuses ShippingProviderMember's shape) ------

CREATE TYPE "TerminalCompanyMemberRole" AS ENUM ('MANAGER', 'OPERATOR');
CREATE TYPE "TerminalCompanyMemberStatus" AS ENUM ('ACTIVE', 'ENDED');

CREATE TABLE "terminal_company_members" (
    "id" TEXT NOT NULL,
    "terminalCompanyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "memberRole" "TerminalCompanyMemberRole" NOT NULL DEFAULT 'OPERATOR',
    "status" "TerminalCompanyMemberStatus" NOT NULL DEFAULT 'ACTIVE',
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "terminal_company_members_pkey" PRIMARY KEY ("id")
);

-- One membership per person per org: re-inviting/re-adding reactivates the
-- row rather than growing a second one for the same pair.
CREATE UNIQUE INDEX "terminal_company_members_terminalCompanyId_userId_key" ON "terminal_company_members" ("terminalCompanyId", "userId");
CREATE INDEX "terminal_company_members_userId_status_idx" ON "terminal_company_members" ("userId", "status");

ALTER TABLE "terminal_company_members" ADD CONSTRAINT "terminal_company_members_terminalCompanyId_fkey"
    FOREIGN KEY ("terminalCompanyId") REFERENCES "terminal_company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_company_members" ADD CONSTRAINT "terminal_company_members_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Member <-> Location grant (the location axis, per-member) -------------

CREATE TABLE "terminal_company_member_locations" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_company_member_locations_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "terminal_company_member_locations_memberId_locationId_key" ON "terminal_company_member_locations" ("memberId", "locationId");
CREATE INDEX "terminal_company_member_locations_locationId_idx" ON "terminal_company_member_locations" ("locationId");

ALTER TABLE "terminal_company_member_locations" ADD CONSTRAINT "terminal_company_member_locations_memberId_fkey"
    FOREIGN KEY ("memberId") REFERENCES "terminal_company_members"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "terminal_company_member_locations" ADD CONSTRAINT "terminal_company_member_locations_locationId_fkey"
    FOREIGN KEY ("locationId") REFERENCES "terminal_company_locations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ---- Invite (the real missing primitive TERM-1's recon found) --------------
-- Raw token emailed once, never stored; only its SHA-256 hash is — exact
-- mirror of email_verification_tokens/password_reset_tokens.

CREATE TABLE "terminal_company_invites" (
    "id" TEXT NOT NULL,
    "terminalCompanyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "memberRole" "TerminalCompanyMemberRole" NOT NULL DEFAULT 'OPERATOR',
    "locationIds" TEXT[],
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "invitedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "terminal_company_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "terminal_company_invites_tokenHash_key" ON "terminal_company_invites" ("tokenHash");
CREATE INDEX "terminal_company_invites_terminalCompanyId_idx" ON "terminal_company_invites" ("terminalCompanyId");
CREATE INDEX "terminal_company_invites_email_idx" ON "terminal_company_invites" ("email");

ALTER TABLE "terminal_company_invites" ADD CONSTRAINT "terminal_company_invites_terminalCompanyId_fkey"
    FOREIGN KEY ("terminalCompanyId") REFERENCES "terminal_company_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- Restrict: the admin who sent an invite is not removable out from under an
-- invite record that still references them as its sender.
ALTER TABLE "terminal_company_invites" ADD CONSTRAINT "terminal_company_invites_invitedById_fkey"
    FOREIGN KEY ("invitedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---- Audit ------------------------------------------------------------------

ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_CREATED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_LOCATION_ADDED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_LOCATION_REMOVED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_MEMBER_INVITED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_INVITE_REVOKED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_INVITE_ACCEPTED';
ALTER TYPE "AuditAction" ADD VALUE IF NOT EXISTS 'TERMINAL_COMPANY_MEMBER_ENDED';
