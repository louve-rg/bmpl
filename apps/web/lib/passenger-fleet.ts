/**
 * Fleet affiliation — MUTUAL CONSENT, presented. Neither party may
 * unilaterally create an active affiliation: each side may only ASK, and only
 * the counterparty's answer activates it. These helpers say, for one row seen
 * from one side, exactly where the consent stands and which verbs the server
 * will accept — a person should never look at this and wonder whether they
 * already agreed to something. Presentation-only mirrors of
 * PassengerAffiliationService; refusals render verbatim if ever out of date.
 */

export type FleetSide = 'DRIVER' | 'PROVIDER';

export interface AffiliationRow {
  id: string;
  initiatedBy: FleetSide;
  status: string;
  message?: string | null;
  acceptedAt?: string | null;
  endedAt?: string | null;
  endedBy?: FleetSide | null;
  createdAt: string;
}

/** Driver-side rows carry the fleet's identity; provider-side rows the driver's. */
export interface DriverAffiliationRow extends AffiliationRow {
  provider: { id: string; businessName: string; district?: string | null; isActive: boolean };
}
export interface ProviderAffiliationRow extends AffiliationRow {
  driver: { id: string; displayName: string; homeDistrict?: string | null; availability?: string; isActive: boolean };
}

export type AffiliationView =
  /** ACCEPTED: a live affiliation either side may end (consent creates; either side dissolves). */
  | { kind: 'active'; action: 'end' }
  /** PENDING, asked by the OTHER side: this side must answer — consent or decline. */
  | { kind: 'answer'; actions: ['consent', 'decline']; waitingOn: 'you' }
  /** PENDING, asked by THIS side: nothing to do but wait or take the ask back. */
  | { kind: 'awaiting'; action: 'withdraw'; waitingOn: 'them' }
  /** DECLINED / WITHDRAWN / ENDED: history, no verbs. */
  | { kind: 'settled' };

export function affiliationView(a: { status: string; initiatedBy: FleetSide }, side: FleetSide): AffiliationView {
  if (a.status === 'ACCEPTED') return { kind: 'active', action: 'end' };
  if (a.status === 'PENDING') {
    return a.initiatedBy === side
      ? { kind: 'awaiting', action: 'withdraw', waitingOn: 'them' }
      : { kind: 'answer', actions: ['consent', 'decline'], waitingOn: 'you' };
  }
  return { kind: 'settled' };
}

/** The consent verb is side-specific in the API and in the copy: a driver ACCEPTS an invitation, an operator APPROVES a request. */
export function consentLabel(side: FleetSide): string {
  return side === 'DRIVER' ? 'Accept' : 'Approve';
}

/** URL path segment for the consent verb, matching the side's controller. */
export function consentPath(side: FleetSide): 'accept' | 'approve' {
  return side === 'DRIVER' ? 'accept' : 'approve';
}

/** Plain words for a settled row, from the reader's side. */
export function settledLabel(a: { status: string; endedBy?: FleetSide | null }, side: FleetSide): string {
  if (a.status === 'DECLINED') return a.endedBy === side ? 'You declined' : 'Declined';
  if (a.status === 'WITHDRAWN') return a.endedBy === side ? 'You withdrew' : 'Withdrawn';
  if (a.status === 'ENDED') return a.endedBy === side ? 'You ended this' : 'Ended';
  return a.status;
}
