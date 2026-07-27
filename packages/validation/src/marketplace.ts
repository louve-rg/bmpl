import { z } from 'zod';
import {
  INVENTORY_CHANGE_REASONS,
  MODERATION_ACTIONS,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
  STORE_STATUSES,
  VENDOR_APPROVAL_STATUSES,
} from '@bmpl/shared';

/**
 * Phase 2 marketplace validation building blocks.
 *
 * This module holds the SHARED primitives (slugs, money, enum schemas, common
 * query shapes). Full per-resource DTOs (vendor profile, product, category,
 * variant, image) are added in their respective milestones and compose these.
 */

/** URL-safe slug: lowercase letters/numbers/hyphens, no leading/trailing hyphen. */
export const slugSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'Slug must be at least 2 characters.')
  .max(80, 'Slug must be at most 80 characters.')
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Use lowercase letters, numbers, and hyphens only.');

/** Money as non-negative integer MINOR units (cents), capped at 1,000,000.00. */
export const moneyMinorSchema = z.coerce
  .number()
  .int('Amount must be a whole number of cents.')
  .min(0, 'Amount cannot be negative.')
  .max(100_000_000, 'Amount is too large.');

/** Optional money (nullable) — used for sale prices / variant overrides. */
export const optionalMoneyMinorSchema = moneyMinorSchema.nullish();

// ---- Enum schemas (mirror @bmpl/shared) -------------------------------------
export const vendorApprovalStatusSchema = z.enum(VENDOR_APPROVAL_STATUSES);
export const storeStatusSchema = z.enum(STORE_STATUSES);
export const productStatusSchema = z.enum(PRODUCT_STATUSES);
export const moderationActionSchema = z.enum(MODERATION_ACTIONS);
export const inventoryChangeReasonSchema = z.enum(INVENTORY_CHANGE_REASONS);
export const productSortSchema = z.enum(PRODUCT_SORTS);

/** A moderation decision body (approve/reject/suspend/restore) with optional note. */
export const moderationDecisionSchema = z.object({
  note: z.string().trim().max(2000).optional(),
});
export type ModerationDecision = z.infer<typeof moderationDecisionSchema>;

/** HH:MM 24-hour time, used by vendor opening hours. */
export const timeOfDaySchema = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use 24-hour HH:MM time.');
