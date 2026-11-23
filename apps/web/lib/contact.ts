/**
 * S2-EMAIL: the ONE general public contact address, shared by the footer,
 * the delivery tracker's help link, and the collection-code lockout
 * message (`CollectionHoldMessage.tsx`'s own comment already named "no
 * second address" as the constraint, before this file existed to enforce
 * it). A second hardcoded copy is a second address that can drift from
 * the first the day one of them changes again.
 */
export const PUBLIC_CONTACT_EMAIL = 'info@bzemarketplace.com';

/** A `mailto:` href for the public contact address, with an optional subject. */
export function contactMailto(subject?: string): string {
  return subject ? `mailto:${PUBLIC_CONTACT_EMAIL}?subject=${encodeURIComponent(subject)}` : `mailto:${PUBLIC_CONTACT_EMAIL}`;
}
