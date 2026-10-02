/**
 * Pure decision logic for resolving a shipment leg exception by return or
 * reroute (BMPL-364/375/343/183) — kept out of the panel component so the
 * owner's pricing rules can be unit-tested without a DOM.
 *
 * BMPL-375, owner ruling: staff action alone must never authorize charging
 * the customer's wallet. Staff with logistics.manage now only PREPARES a
 * return or reroute — it writes a proposal row and nothing money-shaped, and
 * only the shipment's own paying customer, confirming through their own
 * surface, may actually book and charge it. This module (and the panel it
 * backs) used to be the thing that charged the customer; it is now the
 * thing that writes what the customer will be shown. There is no "no
 * confirmation needed" case left on either side of that line: a reroute
 * that does not cost more than the original still needs the customer's own
 * explicit confirmation, just as one that costs more does — the old
 * payment-dialog split this module used to gate on no longer exists.
 *
 * Mirrors exactly what the API itself decides, never a second opinion on
 * top of it: `previewReturn`/`previewReroute` return `quote()`'s own shape,
 * and `priceReturn`/`priceReroute` (reached from both the prepare and the
 * customer's confirm step) apply the SAME zero-price/unavailable guard
 * server-side before anything is ever prepared or charged. This module
 * exists so the screen can show the right message and button BEFORE staff
 * clicks "Prepare," not so it can second-guess what the server will do.
 */

export interface QuotePreview {
  available: boolean;
  totalMinor?: number;
  pricingIncomplete?: boolean;
  pricingNote?: string | null;
  message?: string;
  reason?: string;
  /**
   * Only ever present on a reroute preview, and only when `available`.
   * Informational only (BMPL-375) — whether this leg costs more than the
   * original never changes what staff's own button does; it only changes
   * what the customer is told on their own confirmation screen.
   */
  legCostsMoreThanOriginal?: boolean;
}

/**
 * Whether this preview names a real, chargeable price. ZERO IS NOT A PRICE —
 * the same rule `priceReturn`/`priceReroute` enforce server-side (an
 * unconfigured courier fee must not silently look like a free action). A
 * caller preparing when this is false gets routed to the PENDING_MANUAL
 * outcome automatically; it is never an error to click Prepare here, only
 * ever a different, honest outcome.
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

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/**
 * What the single primary button on the panel says and does, for either
 * fate. Never a plain "Prepare" — the amount (or the honest absence of one)
 * is said OUT LOUD on the button, same rule as before BMPL-375, with
 * "charge" replaced by "prepare" throughout: this button no longer moves
 * any money, it only writes what the customer will be asked to confirm.
 */
export function confirmLabel(kind: 'RETURN' | 'REROUTE', preview: QuotePreview): string {
  if (!canPrice(preview)) return 'Record as pending — no charge';
  const price = money(preview.totalMinor ?? 0);
  return kind === 'RETURN' ? `Prepare return — ${price}` : `Prepare reroute — ${price}`;
}
