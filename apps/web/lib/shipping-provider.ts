/**
 * Carrier (SHIPPING_PROVIDER) self-service surface: response shapes and
 * presentation rules for a carrier organization's own legs, routes and
 * status. Plain data, no React, so the rules are testable without a
 * renderer — same convention as `lib/passenger-operator.ts`. Every mapping
 * here mirrors a server rule verbatim (status gates in
 * `apps/api/src/shipping/provider-eligibility.ts`'s
 * `assertProviderOperableStatus`/`assertProviderContinuationAllowed`); the
 * server is the authority, and its own refusals are shown verbatim wherever
 * these mappings are out of date.
 */

import type { Tone } from '../components/ui';

export type ProviderStatus = 'PENDING' | 'APPROVED' | 'REJECTED' | 'SUSPENDED' | 'REVOKED';

export interface ShippingProviderProfile {
  id: string;
  businessName: string;
  description?: string | null;
  contactEmail: string;
  contactPhone?: string | null;
  district?: string | null;
  city?: string | null;
  addressLine1?: string | null;
  operatingLicenceNumber?: string | null;
  operatingLicenceExpiry?: string | null;
  isActive: boolean;
  isTest: boolean;
  createdAt: string;
  status: ProviderStatus;
  statusReason: string | null;
  statusChangedAt: string | null;
  canResubmit: boolean;
}

export interface ShippingProviderLeg {
  id: string;
  reference: string;
  status: string;
  mode: string;
  modeLabel: string;
  from: { name: string; city: string } | null;
  to: { name: string; city: string } | null;
  pieces: number;
  description: string | null;
  scheduledDepartureAt: string | null;
  scheduledArrivalAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  carrierName: string | null;
  carrierBookingRef: string | null;
  isTest: boolean;
  operatorAcceptedAt: string | null;
  operatorRejectedAt: string | null;
  canAccept: boolean;
  canReject: boolean;
  canDepart: boolean;
  canArrive: boolean;
  canSchedule: boolean;
}

export interface ShippingProviderRoute {
  id: string;
  mode: string;
  isActive: boolean;
  scheduleNote: string | null;
  origin: { id: string; code: string; name: string; city: string };
  destination: { id: string; code: string; name: string; city: string };
}

/**
 * `GET /shipping/provider/routes/available` — status-gated the same way
 * `claimRoute` itself is (claiming is a new commitment, so a SUSPENDED/REVOKED
 * org must not even enumerate newly-claimable routes). When `statusGateEligible`
 * is false, `routes` is always `[]` and `statusGateReason` names why — same
 * vocabulary as the admin console's providers directory.
 */
export interface AvailableRoutesResponse {
  statusGateEligible: boolean;
  statusGateReason: string | null;
  routes: ShippingProviderRoute[];
}

/** A leg this org already holds, awaiting an accept/reject answer — mirrors `providerLegOut`'s own `canAccept`/`canReject` flags rather than re-deriving the same thing from a second field. */
export function isPendingProposal(l: Pick<ShippingProviderLeg, 'canAccept' | 'canReject'>): boolean {
  return l.canAccept && l.canReject;
}

/**
 * Where the carrier's ORGANIZATION (not the generic SHIPPING_PROVIDER role —
 * see OrgStatusCard's own doc comment for why the two are shown separately)
 * stands, and plainly what it may still do. Mirrors
 * `assertProviderOperableStatus`/`assertProviderContinuationAllowed`'s own
 * split exactly: SUSPENDED is an ordinary administrative hold (an
 * already-accepted leg may still be finished; nothing NEW may be taken on);
 * REVOKED is a security/safety cutoff (nothing continues, not even a leg
 * already accepted — an administrator must recover it).
 */
export function orgStatusView(status: ProviderStatus): { tone: Tone; title: string; body: string } {
  switch (status) {
    case 'APPROVED':
      return { tone: 'success', title: 'Approved', body: 'Your organization may take on new work.' };
    case 'PENDING':
      return {
        tone: 'info',
        title: 'Application under review',
        body: 'An administrator is reviewing your organization. You can keep completing your profile meanwhile.',
      };
    case 'REJECTED':
      return { tone: 'error', title: 'Application rejected', body: 'See the reason below.' };
    case 'SUSPENDED':
      return {
        tone: 'warning',
        title: 'Organization suspended — a reversible administrative hold',
        body: 'You may still finish any leg you already accepted — depart, arrive and record its schedule — but you cannot accept a new proposal, claim a route, or change a route’s schedule until this is lifted.',
      };
    case 'REVOKED':
      return {
        tone: 'error',
        title: 'Organization revoked — a security/safety cutoff',
        body: 'You cannot take on or continue any work, including a leg you had already accepted. An administrator will reassign or recover it; this is not something you can do yourself.',
      };
  }
}

/**
 * Short word for the Carrier nav badge (MDF-526), shown only while the
 * SHIPPING_PROVIDER role itself is not yet approved — see
 * `useCarrierApplicationStatus` and `DashboardNavList`. Deliberately shorter
 * than `orgStatusView`'s own copy, which belongs on the status page a click
 * away, not crammed into a nav heading.
 */
export function navApplicationBadge(status: ProviderStatus): string {
  switch (status) {
    case 'PENDING':
      return 'Pending';
    case 'REJECTED':
      return 'Rejected';
    case 'SUSPENDED':
      return 'Suspended';
    case 'REVOKED':
      return 'Revoked';
    case 'APPROVED':
      return 'Role pending';
  }
}

/** BZD-free label for a route-schedule operating status — mirrors `packages/shared/src/service-schedule.ts`'s three values. */
export function operatingStatusLabel(status: string): string {
  if (status === 'OPERATING') return 'Operating';
  if (status === 'REDUCED') return 'Reduced';
  if (status === 'NOT_OPERATING') return 'Not operating';
  return status;
}
