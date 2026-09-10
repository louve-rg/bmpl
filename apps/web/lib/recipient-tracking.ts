import type { RecipientTrackingStep, RecipientTrackingView } from './shipping';

/**
 * Pure helpers for the recipient's public tracking view, kept out of the page so
 * they can be unit-tested without a DOM.
 *
 * The one rule that governs everything here: the recipient sees only what the
 * API chose to hand a person holding a shared link. These helpers read the
 * allowlist payload and never reach for anything outside it.
 */

/** The public tracking path for a capability token. Shareable, no session. */
export function recipientTrackingPath(token: string): string {
  return `/track/${encodeURIComponent(token)}`;
}

/** The full shareable URL, given the site origin (e.g. window.location.origin). */
export function recipientTrackingUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, '')}${recipientTrackingPath(token)}`;
}

/**
 * The one line the recipient reads.
 *
 * A parcel waiting at a terminal says where to collect it — "Delivered" would be
 * a lie and a bare "Awaiting collection" is useless without the place. Everything
 * else falls back to the status label the API already phrased for a customer.
 * No leg detail, no money, no identities — the payload carries none of that.
 */
export function recipientHeadline(view: RecipientTrackingView): string {
  if (view.status === 'AWAITING_COLLECTION' && view.collectionHub) {
    return `Ready to collect at ${view.collectionHub.name}`;
  }
  return view.statusLabel;
}

/** Where the town line comes from, using whichever parts the API returned. */
export function destinationLine(view: RecipientTrackingView): string {
  return [view.destination.city, view.destination.district].filter(Boolean).join(', ');
}

export type StepTone = 'done' | 'current' | 'upcoming';

export function stepTone(step: RecipientTrackingStep): StepTone {
  if (step.completed) return 'done';
  if (step.isCurrent) return 'current';
  return 'upcoming';
}
