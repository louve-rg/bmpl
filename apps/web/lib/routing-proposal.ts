import type { RoutingProposal } from './shipping';

/**
 * Pure decision logic for the customer's own confirmation of a staff-prepared
 * return or reroute (BMPL-364/375) — kept out of the component so the owner's
 * rule can be unit-tested without a DOM. Mirrors the admin exception-
 * resolution panel's own canPrice()/confirmLabel() (BMPL-364/343), customer-
 * voiced: the admin panel was ruled OUT on exactly this shape (staff action
 * alone must never charge a customer's wallet) — this is the real surface
 * that replaces it, never a second opinion on what counts as a price.
 */

/**
 * Whether this proposal names a real, chargeable price RIGHT NOW. Mirrors
 * the server's own ZERO-IS-NOT-A-PRICE guard (priceReturn/priceReroute) —
 * an unconfigured courier fee must never look like a free or a ready-to-pay
 * outcome. False here means there is nothing honest to let the customer
 * confirm toward: offering a button anyway would either charge nothing while
 * looking like it would, or — worse, since confirming CONSUMES the proposal
 * — burn what staff prepared for no reason, leaving nothing for ops to
 * retry against. Never a gate on the price's SIZE (`legCostsMoreThanOriginal`)
 * — that field is informational only, every priced case confirms the same way.
 */
export function canPrice(p: RoutingProposal): boolean {
  return p.available && (p.totalMinor ?? 0) > 0;
}

/** The honest "we don't have a price for this yet" message. */
export function priceUnavailableMessage(p: RoutingProposal): string {
  if (!p.available) return p.message ?? 'We could not calculate a price for this.';
  return p.pricingNote ?? 'We have not finished pricing this yet.';
}

const money = (minor: number) => `$${(minor / 100).toFixed(2)}`;

/**
 * What the single confirm button says — the price stated out loud, never a
 * bare "Confirm", so the customer always sees the number they're agreeing to
 * pay before they click it. Callers only ever render this once canPrice(p)
 * is true, but the fallback to $0.00 if called otherwise is deliberately
 * honest-but-wrong rather than a thrown error — a caller bug should show a
 * silly number, not crash the page.
 */
export function confirmLabel(p: RoutingProposal): string {
  const price = money(p.available ? (p.totalMinor ?? 0) : 0);
  return p.kind === 'RETURN' ? `Confirm and pay ${price}` : `Confirm the new address and pay ${price}`;
}

/** The one-line description of what's being proposed, before the price. */
export function proposalHeadline(p: RoutingProposal): string {
  return p.kind === 'RETURN' ? 'Return this shipment to you' : 'Redirect this shipment to a new address';
}
