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

// ---- Categories (M1) --------------------------------------------------------

const categoryNameSchema = z.string().trim().min(1, 'Name is required.').max(80);
const iconNameSchema = z.string().trim().max(64);
const storageKeySchema = z.string().trim().max(512);
const cuidRef = z.string().cuid2().or(z.string().cuid());

/**
 * Create a category. `slug` is optional — the service derives it from the name
 * (with collision suffixing) when omitted. `parentId` null/undefined = a root
 * category.
 */
export const createCategorySchema = z.object({
  name: categoryNameSchema,
  slug: slugSchema.optional(),
  description: z.string().trim().max(2000).optional(),
  iconName: iconNameSchema.optional(),
  imageKey: storageKeySchema.optional(),
  featured: z.boolean().optional().default(false),
  isVisible: z.boolean().optional().default(true),
  sortOrder: z.coerce.number().int().min(0).max(100000).optional().default(0),
  parentId: cuidRef.nullish(),
});
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;

/** Partial update. Every field optional; `parentId: null` promotes to a root. */
export const updateCategorySchema = z
  .object({
    name: categoryNameSchema,
    slug: slugSchema,
    description: z.string().trim().max(2000).nullable(),
    iconName: iconNameSchema.nullable(),
    imageKey: storageKeySchema.nullable(),
    featured: z.boolean(),
    isVisible: z.boolean(),
    sortOrder: z.coerce.number().int().min(0).max(100000),
    parentId: cuidRef.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
