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
