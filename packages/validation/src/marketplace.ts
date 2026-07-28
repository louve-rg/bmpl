import { z } from 'zod';
import {
  DISTRICTS,
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

// ---- Vendor business profile (M2) -------------------------------------------

const districtSchema = z.enum(DISTRICTS);
const optionalUrl = z
  .string()
  .trim()
  .url('Enter a valid URL.')
  .max(300)
  .or(z.literal(''))
  .optional();

/** Optional, future-ready social links. Unknown keys are stripped. */
export const socialLinksSchema = z
  .object({
    facebook: optionalUrl,
    instagram: optionalUrl,
    twitter: optionalUrl,
    tiktok: optionalUrl,
    whatsapp: z.string().trim().max(40).optional(),
  })
  .strip();

export const createVendorProfileSchema = z.object({
  businessName: z.string().trim().min(2, 'Business name is required.').max(120),
  slug: slugSchema.optional(),
  description: z.string().trim().max(4000).optional(),
  contactEmail: z.string().trim().toLowerCase().email('Enter a valid email.').max(254),
  contactPhone: z.string().trim().max(40).optional(),
  website: optionalUrl,
  socialLinks: socialLinksSchema.optional(),
});
export type CreateVendorProfileInput = z.infer<typeof createVendorProfileSchema>;

export const updateVendorProfileSchema = z
  .object({
    businessName: z.string().trim().min(2).max(120),
    slug: slugSchema,
    description: z.string().trim().max(4000).nullable(),
    contactEmail: z.string().trim().toLowerCase().email().max(254),
    contactPhone: z.string().trim().max(40).nullable(),
    website: optionalUrl,
    socialLinks: socialLinksSchema.nullable(),
    storeStatus: storeStatusSchema,
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdateVendorProfileInput = z.infer<typeof updateVendorProfileSchema>;

export const vendorSettingsSchema = z
  .object({
    pickupEnabled: z.boolean(),
    deliveryEnabled: z.boolean(),
    vacationMode: z.boolean(),
    minimumOrderMinor: moneyMinorSchema.nullable(),
    deliveryRadiusKm: z.coerce.number().int().min(0).max(1000).nullable(),
    taxesEnabled: z.boolean(),
    autoAcceptOrders: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type VendorSettingsInput = z.infer<typeof vendorSettingsSchema>;

export const vendorLocationSchema = z.object({
  label: z.string().trim().min(1).max(120),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional(),
  city: z.string().trim().min(1).max(120),
  district: districtSchema,
  latitude: z.coerce.number().min(-90).max(90).optional(),
  longitude: z.coerce.number().min(-180).max(180).optional(),
  isPrimary: z.boolean().optional().default(false),
});
export type VendorLocationInput = z.infer<typeof vendorLocationSchema>;

export const updateVendorLocationSchema = vendorLocationSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });

/** Replace-all opening hours: one entry per provided day (0–6). */
export const vendorHoursSchema = z.object({
  hours: z
    .array(
      z
        .object({
          dayOfWeek: z.coerce.number().int().min(0).max(6),
          isClosed: z.boolean().default(false),
          openTime: timeOfDaySchema.optional(),
          closeTime: timeOfDaySchema.optional(),
        })
        .refine((h) => h.isClosed || (h.openTime && h.closeTime && h.openTime < h.closeTime), {
          message: 'Open days need an open time earlier than the close time.',
        }),
    )
    .max(7)
    .refine((arr) => new Set(arr.map((h) => h.dayOfWeek)).size === arr.length, {
      message: 'Each day may appear only once.',
    }),
});
export type VendorHoursInput = z.infer<typeof vendorHoursSchema>;

// ---- Marketplace image upload (public bucket): shared by M2 (logo/banner) and M5 --

export const imagePresignSchema = z.object({
  fileName: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(120),
  sizeBytes: z.coerce.number().int().positive(),
});
export type ImagePresignInput = z.infer<typeof imagePresignSchema>;

export const imageConfirmSchema = z.object({
  key: z.string().trim().min(1).max(512),
});
export type ImageConfirmInput = z.infer<typeof imageConfirmSchema>;

/**
 * Confirm a product-image upload. `width`/`height` are client-reported pixel
 * dimensions (the server independently verifies MIME + size via headObject).
 */
export const productImageConfirmSchema = z.object({
  key: z.string().trim().min(1).max(512),
  width: z.coerce.number().int().positive().max(30000).optional(),
  height: z.coerce.number().int().positive().max(30000).optional(),
  altText: z.string().trim().max(300).optional(),
  caption: z.string().trim().max(500).optional(),
});
export type ProductImageConfirmInput = z.infer<typeof productImageConfirmSchema>;

export const productImageUpdateSchema = z
  .object({
    altText: z.string().trim().max(300).nullable(),
    caption: z.string().trim().max(500).nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type ProductImageUpdateInput = z.infer<typeof productImageUpdateSchema>;

/** Reorder a product's images: full ordered list of image ids. */
export const imageReorderSchema = z.object({
  order: z.array(cuidRef).min(1).max(50),
});
export type ImageReorderInput = z.infer<typeof imageReorderSchema>;

// ---- Variants & inventory (M6) ----------------------------------------------

/** Create an option ("Color") with its initial values ("Red","Blue"). */
export const createOptionSchema = z.object({
  name: z.string().trim().min(1).max(60),
  values: z.array(z.string().trim().min(1).max(60)).max(50).optional(),
});
export type CreateOptionInput = z.infer<typeof createOptionSchema>;

export const addOptionValueSchema = z.object({
  value: z.string().trim().min(1).max(60),
});
export type AddOptionValueInput = z.infer<typeof addOptionValueSchema>;

/** A variant = one option-value per option, plus optional sku/price overrides. */
export const createVariantSchema = z.object({
  optionValueIds: z.array(cuidRef).min(1).max(10),
  sku: z.string().trim().min(1).max(64).optional(),
  barcode: z.string().trim().max(64).optional(),
  priceMinor: optionalMoneyMinorSchema,
  salePriceMinor: optionalMoneyMinorSchema,
  // Opening inventory for this variant.
  quantity: z.coerce.number().int().min(0).max(1_000_000).optional().default(0),
});
export type CreateVariantInput = z.infer<typeof createVariantSchema>;

export const updateVariantSchema = z
  .object({
    sku: z.string().trim().min(1).max(64).nullable(),
    barcode: z.string().trim().max(64).nullable(),
    priceMinor: optionalMoneyMinorSchema,
    salePriceMinor: optionalMoneyMinorSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

/** Inventory settings (thresholds/flags) — quantity changes go via /adjust. */
export const inventorySettingsSchema = z
  .object({
    lowStockThreshold: z.coerce.number().int().min(0).max(1_000_000),
    unlimited: z.boolean(),
    allowBackorders: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type InventorySettingsInput = z.infer<typeof inventorySettingsSchema>;

/** Adjust on-hand quantity by a signed delta with a reason (writes history). */
export const inventoryAdjustSchema = z.object({
  delta: z.coerce.number().int().refine((n) => n !== 0, 'Delta cannot be zero.'),
  reason: z.enum(['MANUAL', 'RESTOCK', 'CORRECTION', 'BACKORDER']),
  note: z.string().trim().max(500).optional(),
});
export type InventoryAdjustInput = z.infer<typeof inventoryAdjustSchema>;

// ---- Products (M4) ----------------------------------------------------------

const tagsSchema = z.array(z.string().trim().min(1).max(40)).max(20);
const dimensionSchema = z.coerce.number().int().min(0).max(10_000_000);

const productCore = {
  title: z.string().trim().min(2, 'Title is required.').max(200),
  slug: slugSchema.optional(),
  description: z.string().trim().max(8000).optional(),
  sku: z.string().trim().min(1, 'SKU is required.').max(64),
  barcode: z.string().trim().max(64).optional(),
  categoryId: cuidRef,
  brand: z.string().trim().max(120).optional(),
  priceMinor: moneyMinorSchema,
  salePriceMinor: optionalMoneyMinorSchema,
  weightGrams: dimensionSchema.optional(),
  lengthMm: dimensionSchema.optional(),
  widthMm: dimensionSchema.optional(),
  heightMm: dimensionSchema.optional(),
  featured: z.boolean().optional().default(false),
  tags: tagsSchema.optional(),
  metaTitle: z.string().trim().max(200).optional(),
  metaDescription: z.string().trim().max(500).optional(),
  searchKeywords: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
};

/** salePrice, when present, must not exceed price. */
const saleNotAbovePrice = (v: { priceMinor?: number; salePriceMinor?: number | null }) =>
  v.salePriceMinor == null || v.priceMinor == null || v.salePriceMinor <= v.priceMinor;

export const createProductSchema = z
  .object(productCore)
  .refine(saleNotAbovePrice, { message: 'Sale price cannot exceed the price.', path: ['salePriceMinor'] });
export type CreateProductInput = z.infer<typeof createProductSchema>;

export const updateProductSchema = z
  .object({
    title: z.string().trim().min(2).max(200),
    slug: slugSchema,
    description: z.string().trim().max(8000).nullable(),
    sku: z.string().trim().min(1).max(64),
    barcode: z.string().trim().max(64).nullable(),
    categoryId: cuidRef,
    brand: z.string().trim().max(120).nullable(),
    priceMinor: moneyMinorSchema,
    salePriceMinor: optionalMoneyMinorSchema,
    weightGrams: dimensionSchema.nullable(),
    lengthMm: dimensionSchema.nullable(),
    widthMm: dimensionSchema.nullable(),
    heightMm: dimensionSchema.nullable(),
    featured: z.boolean(),
    tags: tagsSchema,
    metaTitle: z.string().trim().max(200).nullable(),
    metaDescription: z.string().trim().max(500).nullable(),
    searchKeywords: z.array(z.string().trim().min(1).max(40)).max(30),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' })
  .refine(saleNotAbovePrice, { message: 'Sale price cannot exceed the price.', path: ['salePriceMinor'] });
export type UpdateProductInput = z.infer<typeof updateProductSchema>;

/** Public product listing query (PostgreSQL full-text search + filters). */
export const productQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  categoryId: cuidRef.optional(),
  vendorSlug: slugSchema.optional(),
  featured: z.coerce.boolean().optional(),
  inStock: z.coerce.boolean().optional(),
  priceMin: moneyMinorSchema.optional(),
  priceMax: moneyMinorSchema.optional(),
  sort: productSortSchema.optional().default('newest'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(48).default(24),
});
export type ProductQueryInput = z.infer<typeof productQuerySchema>;

/** Public vendor directory query. */
export const vendorQuerySchema = z.object({
  q: z.string().trim().max(120).optional(),
  district: districtSchema.optional(),
});
export type VendorQueryInput = z.infer<typeof vendorQuerySchema>;
