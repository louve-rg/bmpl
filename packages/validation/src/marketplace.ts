import { z } from 'zod';
import {
  DELIVERY_METHODS,
  DISTRICTS,
  INVENTORY_CHANGE_REASONS,
  MODERATION_ACTIONS,
  OUT_OF_BOUNDS_MESSAGE,
  PRODUCT_SORTS,
  PRODUCT_STATUSES,
  STORE_STATUSES,
  UNLOCATABLE_ADDRESS_MESSAGE,
  VENDOR_APPROVAL_STATUSES,
  isWithinBelize,
} from '@bmpl/shared';
import { isLocatable } from './common';

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
    // Delivery pricing (M13): base flat fee + free-delivery threshold (minor units).
    baseDeliveryFeeMinor: moneyMinorSchema.nullable(),
    freeDeliveryThresholdMinor: moneyMinorSchema.nullable(),
    taxesEnabled: z.boolean(),
    autoAcceptOrders: z.boolean(),
    // Auto-hide out-of-stock products/variants from the public marketplace.
    hideOutOfStock: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type VendorSettingsInput = z.infer<typeof vendorSettingsSchema>;

/**
 * A vendor pickup location. The optional coordinate pair is the store's pin, and
 * it is validated exactly like the customer's delivery pin — both or neither,
 * and inside Belize — because it feeds the same route optimizer and the same
 * driver navigation link. One rule, one place.
 */
const vendorLocationBase = z.object({
    label: z.string().trim().min(1).max(120),
    addressLine1: z.string().trim().min(1).max(200),
    addressLine2: z.string().trim().max(200).optional(),
    city: z.string().trim().min(1).max(120),
    district: districtSchema,
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
    // Shown to a driver who has accepted the job: "loading bay round the back".
    pickupInstructions: z.string().trim().max(1000).optional(),
    isPrimary: z.boolean().optional().default(false),
});

/** Both-or-neither, and inside Belize. Shared by create and update. */
const withPinRules = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine((v: { latitude?: number | null; longitude?: number | null }) => (v.latitude == null) === (v.longitude == null), {
      message: 'A pinned location needs both a latitude and a longitude.',
      path: ['latitude'],
    })
    .refine((v: { latitude?: number | null; longitude?: number | null }) => v.latitude == null || isWithinBelize(v.latitude, v.longitude), {
      message: OUT_OF_BOUNDS_MESSAGE,
      path: ['latitude'],
    });

export const vendorLocationSchema = withPinRules(vendorLocationBase);
export type VendorLocationInput = z.infer<typeof vendorLocationBase>;

// `.partial()` has to be applied to the plain object — a refined schema is a
// ZodEffects and has no .partial().
export const updateVendorLocationSchema = withPinRules(
  vendorLocationBase.partial().refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' }),
);

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
  // Optional: tag this image to a specific variant (must belong to the product).
  variantId: cuidRef.optional(),
});
export type ProductImageConfirmInput = z.infer<typeof productImageConfirmSchema>;

export const productImageUpdateSchema = z
  .object({
    altText: z.string().trim().max(300).nullable(),
    caption: z.string().trim().max(500).nullable(),
    // Reassign the image to a variant, or clear it (null = general product image).
    variantId: cuidRef.nullable(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type ProductImageUpdateInput = z.infer<typeof productImageUpdateSchema>;

/** Reorder a product's images: full ordered list of image ids. */
export const imageReorderSchema = z.object({
  order: z.array(cuidRef).min(1).max(50),
});
export type ImageReorderInput = z.infer<typeof imageReorderSchema>;

/**
 * Replace the FILE of an existing image (M6.1) — swaps the stored object in place
 * while preserving the image's variant, gallery position, primary status, alt text,
 * and caption. `key` is the freshly uploaded object (via the normal presign flow).
 */
export const productImageReplaceSchema = z.object({
  key: z.string().trim().min(1).max(512),
  width: z.coerce.number().int().positive().max(30000).optional(),
  height: z.coerce.number().int().positive().max(30000).optional(),
});
export type ProductImageReplaceInput = z.infer<typeof productImageReplaceSchema>;

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

/** Rename an existing option value (label only — does not touch variants). */
export const renameOptionValueSchema = z.object({
  value: z.string().trim().min(1).max(60),
});
export type RenameOptionValueInput = z.infer<typeof renameOptionValueSchema>;

/** A variant = one option-value per option, plus optional display name / sku / price. */
export const createVariantSchema = z.object({
  optionValueIds: z.array(cuidRef).min(1).max(10),
  // Variant-specific marketplace display name (independent of the option labels).
  displayName: z.string().trim().min(1).max(160).optional(),
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
    displayName: z.string().trim().max(160).nullable(),
    sku: z.string().trim().min(1).max(64).nullable(),
    barcode: z.string().trim().max(64).nullable(),
    priceMinor: optionalMoneyMinorSchema,
    salePriceMinor: optionalMoneyMinorSchema,
    isActive: z.boolean(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type UpdateVariantInput = z.infer<typeof updateVariantSchema>;

/** Bulk-generate all missing option-value combinations as variants (idempotent —
 *  only creates combinations that don't already exist; never touches existing ones). */
export const generateVariantsSchema = z
  .object({ quantity: z.coerce.number().int().min(0).max(1_000_000).optional().default(0) })
  .default({ quantity: 0 });
export type GenerateVariantsInput = z.infer<typeof generateVariantsSchema>;

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

// ---- Shopping cart (Phase 3 · M9) -------------------------------------------

/** Maximum units of a single line — a sanity bound, not an inventory limit. */
const cartQtySchema = z.coerce
  .number()
  .int('Quantity must be a whole number.')
  .min(1, 'Quantity must be at least 1.')
  .max(10_000, 'Quantity is too large.');

/**
 * Add an item to the cart. `variantId` null/omitted selects the product-level
 * purchasable; a value selects a specific variant. Repeated additions of the
 * same line MERGE (quantities sum) in the service.
 */
export const addCartItemSchema = z.object({
  productId: cuidRef,
  variantId: cuidRef.nullish(),
  quantity: cartQtySchema.default(1),
});
export type AddCartItemInput = z.infer<typeof addCartItemSchema>;

/** Set a cart line's quantity. Zero/negative is rejected — remove the line instead. */
export const updateCartItemSchema = z.object({
  quantity: cartQtySchema,
});
export type UpdateCartItemInput = z.infer<typeof updateCartItemSchema>;

// ---- Checkout & orders (Phase 3 · M10) --------------------------------------

const deliveryMethodSchema = z.enum(DELIVERY_METHODS);

/**
 * A snapshotted delivery address (required when any vendor uses DELIVERY).
 *
 * WHAT MAKES AN ADDRESS VALID. A driver has to be able to FIND the place, and
 * there are exactly two ways to tell them where it is:
 *
 *   - written down — a street they can read and ask after; or
 *   - pinned — a coordinate their phone can navigate to.
 *
 * EITHER ONE ALONE IS COMPLETE. This schema used to demand both, which made
 * "drop a pin" pointless: a customer who had shown us their exact doorstep was
 * told the address was missing and could not check out. In Belize the pin is
 * frequently the BETTER of the two — "behind the old bridge" is a real address
 * and a useless navigation target — so refusing it refused the good answer.
 *
 * Still unconditional: who to hand the parcel to, the town, and the district.
 * The last two are not location detail here — they are what price the delivery
 * and what dispatch matches drivers on — and no pin is allowed to imply them,
 * because a mis-dropped pin would then silently re-price the order.
 *
 * The coordinate rules are unchanged, and both have to hold on the SERVER
 * because a request body can claim anything:
 *
 *  - both or neither. A lone latitude is not a location, and storing half a
 *    pin would leave the route optimizer reading a null as "unknown" while the
 *    UI showed a location as pinned.
 *  - inside Belize. A generic -90..90 / -180..180 check happily accepts the
 *    middle of the Pacific, and a transposed lat/lng — the single most likely
 *    mistake — passes it too. Such a coordinate would be snapshotted onto the
 *    order and then distort the sequencing of every other stop in the driver's
 *    queue.
 */
export const orderAddressSchema = z
  .object({
    fullName: z.string().trim().min(1, 'Full name is required.').max(160),
    phone: z.string().trim().max(40).optional(),
    // Optional individually. The locatability rule below is what actually
    // decides whether enough of the address is present.
    addressLine1: z.string().trim().min(1).max(200).optional(),
    addressLine2: z.string().trim().max(200).optional(),
    // Required in its own right, pin or no pin: the town is what a driver
    // recognises on arrival and what the delivery quote is priced against.
    city: z.string().trim().min(1, 'City is required.').max(120),
    district: z.enum(DISTRICTS),
    latitude: z.coerce.number().min(-90).max(90).optional(),
    longitude: z.coerce.number().min(-180).max(180).optional(),
  })
  .refine((v) => (v.latitude == null) === (v.longitude == null), {
    message: 'A pinned location needs both a latitude and a longitude.',
    path: ['latitude'],
  })
  .refine((v) => v.latitude == null || isWithinBelize(v.latitude, v.longitude), {
    message: OUT_OF_BOUNDS_MESSAGE,
    path: ['latitude'],
  })
  .refine((v) => isLocatable({ street: v.addressLine1, latitude: v.latitude, longitude: v.longitude }), {
    message: UNLOCATABLE_ADDRESS_MESSAGE,
    // Reported against the street field because that is the one a customer who
    // has given us neither is most likely to reach for. The message names the
    // pin as the other way out.
    path: ['addressLine1'],
  });

export type OrderAddressInput = z.infer<typeof orderAddressSchema>;

/** Per-vendor fulfilment choice at checkout. */
export const checkoutVendorSchema = z.object({
  vendorProfileId: cuidRef,
  deliveryMethod: deliveryMethodSchema,
  customerNotes: z.string().trim().max(1000).optional(),
  // Delivery-only instructions (M13), snapshotted onto the order delivery.
  deliveryInstructions: z.string().trim().max(1000).optional(),
});

/**
 * Checkout the active cart. `vendors` sets per-storefront delivery method +
 * notes (any storefront omitted defaults to PICKUP). `deliveryAddress` is
 * required when at least one vendor uses DELIVERY (enforced in the service,
 * which knows the cart's actual vendors). No prices are accepted — the server
 * recalculates and snapshots everything.
 */
export const checkoutSchema = z.object({
  vendors: z.array(checkoutVendorSchema).max(100).optional().default([]),
  deliveryAddress: orderAddressSchema.optional(),
  /**
   * Pay for this order from the BML wallet as part of placing it.
   *
   * Defaults to FALSE so the existing behaviour — an order placed with a pending
   * payment and a soft hold, no money moved — is exactly what it was. Opting in
   * makes checkout atomic: the escrow debit happens inside the same transaction
   * that creates the order, so there is no window in which an order exists
   * unpaid, and an insufficient balance leaves no order behind at all.
   */
  payWithWallet: z.boolean().optional().default(false),
});
export type CheckoutInput = z.infer<typeof checkoutSchema>;

/**
 * Customer cancels their own order — whole order, only while every
 * vendor-order is still PENDING (the vendor has not begun preparing). The
 * reason is optional and shown to the vendor; the window and everything the
 * cancellation touches are enforced in the service.
 */
export const cancelOrderSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});
export type CancelOrderInput = z.infer<typeof cancelOrderSchema>;

// ---- Delivery & Shipping Foundation (Phase 4 · M13) -------------------------

/** Vendor delivery zone: a named set of districts with a flat delivery fee. */
export const deliveryZoneSchema = z.object({
  name: z.string().trim().min(1, 'Zone name is required.').max(120),
  districts: z.array(districtSchema).min(1, 'Select at least one district.').max(6),
  feeMinor: moneyMinorSchema, // >= 0
  isActive: z.boolean().optional().default(true),
});
export type DeliveryZoneInput = z.infer<typeof deliveryZoneSchema>;

export const deliveryZoneUpdateSchema = deliveryZoneSchema
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });
export type DeliveryZoneUpdateInput = z.infer<typeof deliveryZoneUpdateSchema>;

/** Vendor estimated delivery time window (hours). */
export const deliveryEstimateSchema = z
  .object({
    minHours: z.coerce.number().int().min(0).max(2160),
    maxHours: z.coerce.number().int().min(0).max(2160),
    label: z.string().trim().max(120).optional(),
  })
  .refine((v) => v.maxHours >= v.minHours, { message: 'Max hours must be ≥ min hours.', path: ['maxHours'] });
export type DeliveryEstimateInput = z.infer<typeof deliveryEstimateSchema>;

/** Quote the current cart's delivery fees/estimates against a destination district. */
export const deliveryQuoteSchema = z.object({
  district: districtSchema,
  vendors: z
    .array(z.object({ vendorProfileId: cuidRef, deliveryMethod: deliveryMethodSchema }))
    .max(100)
    .optional()
    .default([]),
});
export type DeliveryQuoteInput = z.infer<typeof deliveryQuoteSchema>;

/**
 * Adding money to a wallet.
 *
 * Capped at BZD 5,000 per request. Not a policy about how rich anyone may be —
 * a bound that keeps a mistyped amount from creating an absurd ledger entry that
 * somebody then has to explain.
 */
export const walletTopUpSchema = z.object({
  amountMinor: z.coerce.number().int().min(100, 'Enter at least BZD 1.00.').max(500_000, 'That is more than a single top-up allows.'),
});
export type WalletTopUpInput = z.infer<typeof walletTopUpSchema>;

/* ---------------------------------------------------------------- addresses */

/**
 * A saved address.
 *
 * Coordinates are optional but strongly wanted: the customer can always type an
 * address and skip the pin, and a form that refuses to save without one would
 * simply stop people saving addresses. Where a pin IS given it is validated to
 * be a real coordinate, because a driver is going to be sent to it.
 */
export const savedAddressSchema = z.object({
  label: z.string().trim().min(1).max(60),
  fullName: z.string().trim().min(1).max(120),
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().max(160).optional().nullable(),
  company: z.string().trim().max(120).optional().nullable(),
  addressLine1: z.string().trim().min(1).max(200),
  addressLine2: z.string().trim().max(200).optional().nullable(),
  city: z.string().trim().min(1).max(120),
  district: z.enum(DISTRICTS),
  instructions: z.string().trim().max(500).optional().nullable(),
  latitude: z.number().min(-90).max(90).optional().nullable(),
  longitude: z.number().min(-180).max(180).optional().nullable(),
  isDefault: z.boolean().optional().default(false),
});
export type SavedAddressInput = z.infer<typeof savedAddressSchema>;

export const savedAddressUpdateSchema = savedAddressSchema.partial();
export type SavedAddressUpdateInput = z.infer<typeof savedAddressUpdateSchema>;
