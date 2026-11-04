import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { Prisma, PrismaClient, ShippingProviderStatus } from '@bmpl/database';
import { isOperableProviderStatus } from '@bmpl/shared';

type Db = PrismaClient | Prisma.TransactionClient;

const PROVIDER_ELIGIBILITY_SELECT = {
  id: true,
  isActive: true,
  isTest: true,
  businessName: true,
  status: true,
  user: { select: { roles: { where: { roleCode: 'SHIPPING_PROVIDER' as const }, select: { status: true } } } },
} satisfies Prisma.ShippingProviderProfileSelect;

type EligibilityRow = Prisma.ShippingProviderProfileGetPayload<{ select: typeof PROVIDER_ELIGIBILITY_SELECT }>;

function statusLabel(s: ShippingProviderStatus): string {
  return s.toLowerCase();
}

/**
 * MDF-COURIER D4: every reason this profile may NOT be handed work right
 * now, collected rather than short-circuited — the `eligibility()` pattern
 * `driver.service.ts` already uses for a driver's own ONLINE gate. Never
 * throws. `assertOperableProvider` below is the throwing wrapper every
 * write path uses; this is the read-only preview an admin needs to answer
 * "why is this carrier/route ineligible" before committing anything.
 */
export function providerEligibilityReasons(profile: EligibilityRow, isTestWork: boolean): string[] {
  const reasons: string[] = [];
  if (!profile.isActive) reasons.push('carrier deactivated');
  // D1b: two independent sources of truth, AND-gated here and ONLY here —
  // this column and the generic SHIPPING_PROVIDER role grant are never
  // derived from each other (see the ShippingProviderStatus enum's own doc
  // comment in schema.prisma for why). Either one failing is reported;
  // both are checked even if the first already fails, so an admin fixing
  // one does not get surprised by a second reason appearing afterward.
  if (!isOperableProviderStatus(profile.status)) reasons.push(`carrier status is ${statusLabel(profile.status)}, not approved to operate`);
  const roleStatus = profile.user.roles[0]?.status;
  if (roleStatus !== 'APPROVED') {
    reasons.push(roleStatus === 'SUSPENDED' ? 'shipping provider role suspended' : roleStatus === 'REVOKED' ? 'shipping provider role revoked' : 'shipping provider role not approved');
  }
  if (isTestWork && !profile.isTest) reasons.push('simulation work can only be operated by a designated test carrier');
  if (!isTestWork && profile.isTest) reasons.push('a test carrier cannot operate a real customer shipment');
  return reasons;
}

async function loadForEligibility(db: Db, providerProfileId: string): Promise<EligibilityRow | null> {
  return db.shippingProviderProfile.findUnique({ where: { id: providerProfileId }, select: PROVIDER_ELIGIBILITY_SELECT });
}

/**
 * May this carrier organization be handed work on this side of the
 * simulation boundary? Throws with the first failing reason. Module-level
 * on purpose: LogisticsNetworkService (route operator) and
 * ShippingProviderService (leg operator) both need the same rule, and
 * putting it on either service would close an import cycle through
 * ShipmentService. One implementation, no cycle, no second copy to drift.
 */
export async function assertOperableProvider(db: Db, providerProfileId: string, isTestWork: boolean) {
  const profile = await loadForEligibility(db, providerProfileId);
  if (!profile) throw new NotFoundException('That carrier does not exist.');
  const [reason] = providerEligibilityReasons(profile, isTestWork);
  if (reason) throw new BadRequestException(`That carrier cannot take this work: ${reason}.`);
  return profile;
}

/**
 * D4 — the read-only preview `assertOperableProvider` cannot give: every
 * reason this carrier is ineligible for the given side of the simulation
 * boundary, or none if it may be handed work right now. A flat boolean
 * fails the owner's bar; this is what the admin desk calls before
 * committing to a leg/route assignment.
 */
export async function previewProviderEligibility(db: Db, providerProfileId: string, isTestWork: boolean) {
  const profile = await loadForEligibility(db, providerProfileId);
  if (!profile) throw new NotFoundException('That carrier does not exist.');
  const reasons = providerEligibilityReasons(profile, isTestWork);
  return { providerProfileId, businessName: profile.businessName, eligible: reasons.length === 0, reasons };
}
