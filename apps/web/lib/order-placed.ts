/**
 * The one sentence a customer reads after placing an order — BMPL-155.
 *
 * The old banner hardcoded "Your order is pending. … Payment will be added
 * in a later update." for every arrival from checkout — two falsehoods in
 * one sentence for a customer who had just paid from their wallet (the
 * escrow debit happens inside the order transaction), sitting directly
 * above a status badge showing the truth. The badge IS the source of truth
 * for order and payment state, so this banner deliberately claims neither:
 * it states only what checkout guarantees on BOTH payment paths, and the
 * test pins that no payment-state claim can creep back in.
 */
export const ORDER_PLACED_MESSAGE =
  'Your items are reserved. This page tracks everything that happens next.';
