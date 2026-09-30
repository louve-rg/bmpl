/**
 * Pure view logic for the shipping courier's job detail — kept out of the
 * page component so it can be unit-tested without a DOM (same convention as
 * lib/driver-job.ts, the marketplace equivalent).
 */

export type PickupPhotoSection = 'hidden' | 'existing' | 'addable';

/**
 * Which of the three pickup-photo states to render (BMPL-178/352, Edward
 * req 2) — decided once, pure, so the "only offer 'add' when nothing is
 * attached yet" rule (see the page's own `addPhoto` comment for why a
 * second session cannot safely add to a first, since `confirmPickupPhoto`
 * replaces the stored keys wholesale and the read side never returns the
 * underlying keys back) can't drift between JSX branches.
 *
 * `job.addressUnlocked` is the same gate the address reveal already uses —
 * there is nothing to photograph at a door you have not committed to yet.
 * `canAct` is whether the leg still has a next action (false once
 * COMPLETED/CANCELLED/EXCEPTION), matching the API's own refusal window on
 * `confirmPickupPhoto`. `pickupPhotoUrls` absent is treated exactly like
 * empty — web and api deploy independently, and a required field read
 * unguarded is how a screen crashes on the api side lagging behind a merge
 * (BMPL-349).
 */
export function pickupPhotoSection(
  job: { addressUnlocked: boolean; pickupPhotoUrls?: string[] },
  canAct: boolean,
): PickupPhotoSection {
  if (!job.addressUnlocked) return 'hidden';
  if (job.pickupPhotoUrls && job.pickupPhotoUrls.length > 0) return 'existing';
  return canAct ? 'addable' : 'hidden';
}
