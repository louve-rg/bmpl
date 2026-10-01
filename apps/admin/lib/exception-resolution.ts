/**
 * Pure decision logic for resolving a shipment leg exception by return or
 * reroute (BMPL-364/343/183) — kept out of the panel component so the
 * owner's pricing rules can be unit-tested without a DOM.
 *
 * Mirrors exactly what the API itself decides, never a second opinion on
 * top of it: `previewReturn`/`previewReroute` return `quote()`'s own shape,
 * and `returnToSender`/`rerouteShipment` apply the SAME zero-price/
 * unavailable guard server-side before ever charging anyone. This module
 * exists so the screen can show the right message and button BEFORE the
 * staff member clicks confirm, not so it can second-guess what the server
 * will do.
 */

export interface QuotePreview {
  available: boolean;
  totalMinor?: number;
  pricingIncomplete?: boolean;
  pricingNote?: string | null;
  message?: string;
  reason?: string;
  /** Only ever present on a reroute preview, and only when `available`. */
  increasesCharge?: boolean;
}

/**
 * Whether this preview names a real, chargeable price. ZERO IS NOT A PRICE —
 * the same rule `returnToSender`/`rerouteShipment` enforce server-side
 * (an unconfigured courier fee must not silently look like a free action).
 * A caller confirming when this is false gets routed to the PENDING_MANUAL
 * outcome automatically; it is never an error to confirm here, only ever a
 * different, honest outcome.
 */
export function canPrice(preview: QuotePreview): boolean {
  return preview.available && (preview.totalMinor ?? 0) > 0;
}

/** The honest "we cannot price this" message, for whichever of the two
 *  reasons applies: the planner itself has no route (mid-carry, no lane
 *  configured), or it technically priced but at zero (an unconfigured fee). */
export function priceUnavailableMessage(preview: QuotePreview): string {
  if (!preview.available) return preview.message ?? 'This route cannot be priced yet.';
  return preview.pricingNote ?? 'This route has not been priced yet.';
}

/**
 * Owner Ruling 2 (BMPL-343): a reroute that does not increase what the
 * customer already paid needs no payment-confirmation dialog — only one
 * that does. `increasesCharge` is absent whenever there is no real price to
 * compare (the unpriced/unavailable case), and absent reads as "no dialog
 * needed" — the safe default, since there is nothing to confirm paying in
 * that case either (see `canPrice`).
 */
export function needsPaymentConfirmation(preview: QuotePreview): boolean {
  return canPrice(preview) && preview.increasesCharge === true;
}

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/**
 * What the single primary button on the panel says and does, for either
 * fate. Never a plain "Confirm" — the owner's rule is that the amount (or
 * the honest absence of one) is said OUT LOUD on the button a staff member
 * is about to press, not just somewhere above it.
 */
export function confirmLabel(kind: 'RETURN' | 'REROUTE', preview: QuotePreview): string {
  if (!canPrice(preview)) return 'Record as pending — no charge';
  const price = money(preview.totalMinor ?? 0);
  if (kind === 'RETURN') return `Confirm return — charge ${price}`;
  return needsPaymentConfirmation(preview)
    ? `Confirm reroute — charge ${price}`
    : `Confirm reroute — ${price}, no change to what was already paid`;
}
