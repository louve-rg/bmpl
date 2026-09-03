import { z } from 'zod';
import { DISTRICTS, ROLE_CODES, ROLE_STATUSES } from '@bmpl/shared';

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(254)
  .email('Enter a valid email address.');

/**
 * Password policy: min 10 chars, at least one letter and one number.
 * Deliberately strong but not hostile; server-enforced.
 */
export const passwordSchema = z
  .string()
  .min(10, 'Password must be at least 10 characters.')
  .max(128, 'Password must be at most 128 characters.')
  .regex(/[A-Za-z]/, 'Password must contain a letter.')
  .regex(/[0-9]/, 'Password must contain a number.');

/** Belize phone numbers: accepts +501 international or local 7-digit forms. */
export const phoneSchema = z
  .string()
  .trim()
  .regex(/^(\+?501[- ]?)?\d{3}[- ]?\d{4}$/, 'Enter a valid Belize phone number.');

export const districtSchema = z.enum(DISTRICTS);
export const roleCodeSchema = z.enum(ROLE_CODES);
export const roleStatusSchema = z.enum(ROLE_STATUSES);

export const cuidSchema = z.string().cuid2().or(z.string().cuid());
export const uuidSchema = z.string().uuid();

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export type Pagination = z.infer<typeof paginationSchema>;

/**
 * Is there enough here for a driver to FIND the place?
 *
 * Two ways to answer "where", and either one alone is complete:
 *
 *   - written down — a street they can read and ask after; or
 *   - pinned — a coordinate their phone can navigate to.
 *
 * Demanding BOTH is what made "drop a pin" pointless: a customer who had shown
 * us their exact doorstep was still told the address was missing. In Belize the
 * pin is frequently the better of the two — "behind the old bridge" is a real
 * address and a useless navigation target — so refusing it refused the good
 * answer.
 *
 * NOT part of this question: the town and the district. Those are still
 * required in their own right wherever a delivery is priced, because they are
 * what decides the fee, which drivers are matched, and — for a shipment —
 * whether a road courier can make the trip at all. A pin does not imply them:
 * accepting one that did would let a mis-dropped pin silently re-price an order
 * or plan a road journey across water.
 *
 * One helper because checkout, shipment booking and the browser form all ask the
 * same question, and three copies of it is how they come to disagree.
 */
export function isLocatable(v: { street?: string | null; latitude?: number | null; longitude?: number | null }): boolean {
  return !!v.street?.trim() || (v.latitude != null && v.longitude != null);
}
