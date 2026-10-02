/**
 * Pure view logic for a driver's job detail — kept out of the page component so
 * it can be unit-tested without a DOM.
 *
 * The one rule that matters here: a delivery's pickup location can be **absent**.
 * The API serialises `pickupLocation: null` whenever the vendor has no pickup
 * location on file, and checkout and dispatch both allow such an order to exist
 * and be assigned to a driver. The page must therefore treat a missing pickup as
 * a first-class state and say so, never dereference it — an unguarded
 * `pickup.addressLine1` on a null pickup crashed the whole job page to a blank
 * error boundary (BMPL-113), leaving a driver unable to work the job with no
 * explanation.
 */

import { tripMapPoints, type MapPoint } from './trip-map';

export interface PickupLocation {
  label?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  district?: string | null;
  pinnedLocation?: { latitude: number; longitude: number } | null;
  navigationUrl?: string | null;
  pickupInstructions?: string | null;
}

/** What the pickup block should render, decided once, safely, for any input. */
export interface PickupView {
  /** True when the vendor has given no pickup location at all. */
  missing: boolean;
  label: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  /** "City, District" with the parts that are present, or "" when neither is. */
  cityLine: string;
  instructions: string | null;
  navigationUrl: string | null;
  /** Whether there is a written address to fall back on when there is no pin. */
  hasAddress: boolean;
}

function districtLabel(d?: string | null): string {
  return d ? d.replace(/_/g, ' ') : '';
}

/**
 * Decide the pickup view from a possibly-null pickup location.
 *
 * A `null` pickup yields `{ missing: true }` and empty fields — the caller shows
 * an honest "no pickup address" message instead of a crash. A present pickup is
 * mapped field-for-field, exactly as the block rendered before.
 */
export function pickupView(pickup: PickupLocation | null | undefined): PickupView {
  if (!pickup) {
    return {
      missing: true,
      label: null,
      addressLine1: null,
      addressLine2: null,
      cityLine: '',
      instructions: null,
      navigationUrl: null,
      hasAddress: false,
    };
  }
  const cityLine = [pickup.city, districtLabel(pickup.district)].filter(Boolean).join(', ');
  return {
    missing: false,
    label: pickup.label ?? null,
    addressLine1: pickup.addressLine1 ?? null,
    addressLine2: pickup.addressLine2 ?? null,
    cityLine,
    instructions: pickup.pickupInstructions ?? null,
    navigationUrl: pickup.navigationUrl ?? null,
    hasAddress: Boolean(pickup.addressLine1 || pickup.city),
  };
}

/**
 * The two pins this job can honestly put on a map — Edward requirement 8 for
 * a marketplace delivery, the same `tripMapPoints` rule shipping's courier
 * legs already use (BMPL-136): only a stop that actually carries a
 * `pinnedLocation` is drawn, in whatever order it arrives.
 *
 * The vendor's pickup pin is never gated — it is a business address, and
 * `delivery-core.service.ts` sends it unconditionally. The customer's
 * delivery pin is gated on acceptance server-side (`pinnedLocation: null`
 * until `addressUnlocked`); this function does not re-check that gate, it
 * only ever draws what it is given — so a pre-acceptance call naturally
 * yields a single pickup-only pin, never a guessed or invented delivery
 * point. `tripMapPoints` itself assigns "Collect"/"Deliver" by which stops
 * are actually VISIBLE, so a withheld delivery pin cannot mislabel the
 * pickup as "Via" (BMPL-198).
 */
export function jobMapPoints(job: {
  pickupLocation?: PickupLocation | null;
  vendor?: { businessName?: string | null } | null;
  deliveryAddress?: { fullName?: string | null; city?: string | null; district?: string | null } | null;
  pinnedLocation?: { latitude: number; longitude: number } | null;
}): MapPoint[] {
  const pickup = job.pickupLocation
    ? {
        name: job.vendor?.businessName ?? job.pickupLocation.label ?? null,
        area: [job.pickupLocation.city, districtLabel(job.pickupLocation.district)].filter(Boolean).join(', ') || null,
        pinnedLocation: job.pickupLocation.pinnedLocation ?? null,
      }
    : null;
  const delivery = job.deliveryAddress
    ? {
        name: job.deliveryAddress.fullName ?? null,
        area: [job.deliveryAddress.city, districtLabel(job.deliveryAddress.district)].filter(Boolean).join(', ') || null,
        pinnedLocation: job.pinnedLocation ?? null,
      }
    : null;
  return tripMapPoints([pickup, delivery]);
}
