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
