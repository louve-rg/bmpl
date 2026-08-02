/**
 * Marketing & Business Promotion (Phase 6 · M26) — request validation.
 * Money is BZD minor units (non-negative ints). Targets/placements/assets are
 * normalized objects (never JSON blobs). Coupon codes are normalized upstream.
 */
import { z } from 'zod';
import {
  PROMOTION_TYPES,
  PROMOTION_TARGET_TYPES,
  PROMOTION_PLACEMENTS,
  PROMOTION_ASSET_KINDS,
  PROMOTION_REPORT_REASONS,
  PROMOTION_MODERATION_ACTIONS,
  PROMOTION_OWNER_ACTIONS,
  PROMOTION_SORTS,
  CAMPAIGN_TYPES,
  CAMPAIGN_STATUSES,
  COUPON_DISCOUNT_TYPES,
  COUPON_SCOPES,
  COUPON_STATUSES,
  COUPON_CODE_PATTERN,
  MAX_PROMOTION_ASSETS,
  MAX_PROMOTION_TARGETS,
} from '@bmpl/shared';

// eslint-disable-next-line no-control-regex
const CONTROL = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F\\u007F-\\u009F]', 'g');
const clean = (s: string) => s.replace(CONTROL, '').trim();
const text = (min: number, max: number) => z.string().transform(clean).pipe(z.string().min(min).max(max));
const optText = (max: number) =>
  z.string().transform(clean).pipe(z.string().max(max)).transform((s) => (s === '' ? null : s)).nullable().optional();
const cuid = z.string().cuid2().or(z.string().cuid());
const moneyMinor = z.coerce.number().int().min(0).max(100_000_000_000);
const url = z.string().url().max(2048);

/* ============================================================== campaigns */
export const createCampaignSchema = z.object({
  name: text(2, 160),
  description: optText(2000),
  type: z.enum(CAMPAIGN_TYPES),
  timezone: optText(64),
});
export const updateCampaignSchema = createCampaignSchema.partial().refine((v) => Object.keys(v).length > 0, {
  message: 'No fields to update.',
});

export const campaignScheduleSchema = z
  .object({
    startAt: z.coerce.date(),
    endAt: z.coerce.date(),
    timezone: optText(64),
  })
  .refine((v) => v.endAt > v.startAt, { message: 'endAt must be after startAt.', path: ['endAt'] });

/** Admin campaign lifecycle transition (validated against CAMPAIGN_TRANSITIONS in the service). */
export const campaignStatusSchema = z.object({
  status: z.enum(CAMPAIGN_STATUSES),
  note: optText(1000),
});

/* ============================================================= promotions */
const placementInput = z
  .object({
    placement: z.enum(PROMOTION_PLACEMENTS),
    position: z.coerce.number().int().min(0).max(10_000).optional(),
    categoryId: cuid.nullable().optional(),
  })
  .strict();

const targetInput = z
  .object({
    targetType: z.enum(PROMOTION_TARGET_TYPES),
    vendorProfileId: cuid.nullable().optional(),
    employerProfileId: cuid.nullable().optional(),
    agencyProfileId: cuid.nullable().optional(),
    agentProfileId: cuid.nullable().optional(),
    propertyOwnerProfileId: cuid.nullable().optional(),
    productId: cuid.nullable().optional(),
    jobListingId: cuid.nullable().optional(),
    propertyListingId: cuid.nullable().optional(),
    externalUrl: url.nullable().optional(),
  })
  .strict();

export const createPromotionSchema = z
  .object({
    type: z.enum(PROMOTION_TYPES),
    title: text(2, 160),
    subtitle: optText(200),
    description: optText(4000),
    campaignId: cuid.nullable().optional(),
    priority: z.coerce.number().int().min(0).max(1000).optional(),
    startAt: z.coerce.date().nullable().optional(),
    endAt: z.coerce.date().nullable().optional(),
    timezone: optText(64),
    placements: z.array(placementInput).max(PROMOTION_PLACEMENTS.length).optional(),
    targets: z.array(targetInput).max(MAX_PROMOTION_TARGETS).optional(),
  })
  .refine((v) => !(v.startAt && v.endAt) || v.endAt > v.startAt, {
    message: 'endAt must be after startAt.',
    path: ['endAt'],
  });

export const updatePromotionSchema = z
  .object({
    title: text(2, 160).optional(),
    subtitle: optText(200),
    description: optText(4000),
    campaignId: cuid.nullable().optional(),
    priority: z.coerce.number().int().min(0).max(1000).optional(),
    startAt: z.coerce.date().nullable().optional(),
    endAt: z.coerce.date().nullable().optional(),
    timezone: optText(64),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });

/** Replace the full placement set for a promotion. */
export const setPlacementsSchema = z.object({ placements: z.array(placementInput).max(PROMOTION_PLACEMENTS.length) });
/** Replace the full target set for a promotion. */
export const setTargetsSchema = z.object({ targets: z.array(targetInput).max(MAX_PROMOTION_TARGETS) });

export const promotionAssetPresignSchema = z.object({
  kind: z.enum(PROMOTION_ASSET_KINDS),
  fileName: text(1, 256),
  contentType: text(1, 128),
  sizeBytes: z.coerce.number().int().min(1).max(50_000_000),
});
export const promotionAssetConfirmSchema = z.object({
  kind: z.enum(PROMOTION_ASSET_KINDS),
  storageKey: optText(512),
  altText: optText(200),
  videoUrl: url.nullable().optional(),
  position: z.coerce.number().int().min(0).max(10_000).optional(),
});

export const promotionOwnerActionSchema = z.object({
  action: z.enum(PROMOTION_OWNER_ACTIONS),
});

export const promotionModerateSchema = z.object({
  action: z.enum(PROMOTION_MODERATION_ACTIONS),
  reason: optText(1000),
});

export const promotionSearchSchema = z.object({
  q: optText(160),
  type: z.enum(PROMOTION_TYPES).optional(),
  placement: z.enum(PROMOTION_PLACEMENTS).optional(),
  categoryId: cuid.optional(),
  sort: z.enum(PROMOTION_SORTS).optional(),
  page: z.coerce.number().int().min(1).max(10_000).optional(),
});

/* -------- metric tracking (public, best-effort; never trusts client counts) */
export const trackPromotionEventSchema = z.object({
  event: z.enum(['impression', 'view', 'click', 'conversion']),
  placement: z.enum(PROMOTION_PLACEMENTS).nullable().optional(),
});

/* -------- reports + moderation */
export const promotionReportSchema = z.object({
  reason: z.enum(PROMOTION_REPORT_REASONS),
  note: optText(1000),
});
export const resolvePromotionReportSchema = z.object({
  status: z.enum(['ACTIONED', 'DISMISSED']),
  note: optText(1000),
});

/* ================================================================ coupons */
const couponCore = {
  code: z
    .string()
    .transform((s) => s.trim().toUpperCase())
    .pipe(z.string().regex(COUPON_CODE_PATTERN, 'Code must be 3–32 chars: A–Z, 0–9, dashes.')),
  discountType: z.enum(COUPON_DISCOUNT_TYPES),
  percentOff: z.coerce.number().int().min(1).max(100).nullable().optional(),
  amountOffMinor: moneyMinor.nullable().optional(),
  freeShipping: z.boolean().optional(),
  minSpendMinor: moneyMinor.nullable().optional(),
  maxDiscountMinor: moneyMinor.nullable().optional(),
  maxUses: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
  perUserLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
  stackable: z.boolean().optional(),
  campaignId: cuid.nullable().optional(),
  startAt: z.coerce.date().nullable().optional(),
  endAt: z.coerce.date().nullable().optional(),
};

/** A coupon must define exactly the discount fields matching its type. */
const couponDiscountRefine = (v: { discountType: string; percentOff?: number | null; amountOffMinor?: number | null }) =>
  v.discountType === 'PERCENTAGE'
    ? v.percentOff != null && v.amountOffMinor == null
    : v.amountOffMinor != null && v.percentOff == null;

export const createCouponSchema = z
  .object(couponCore)
  .refine(couponDiscountRefine, { message: 'Provide percentOff for PERCENTAGE, or amountOffMinor for FIXED_AMOUNT (not both).', path: ['discountType'] })
  .refine((v) => !(v.startAt && v.endAt) || v.endAt > v.startAt, { message: 'endAt must be after startAt.', path: ['endAt'] });

/** Admin platform coupons may additionally set scope. */
export const createPlatformCouponSchema = z
  .object({ ...couponCore, scope: z.enum(COUPON_SCOPES).optional() })
  .refine(couponDiscountRefine, { message: 'Provide percentOff for PERCENTAGE, or amountOffMinor for FIXED_AMOUNT (not both).', path: ['discountType'] })
  .refine((v) => !(v.startAt && v.endAt) || v.endAt > v.startAt, { message: 'endAt must be after startAt.', path: ['endAt'] });

export const updateCouponSchema = z
  .object({
    percentOff: z.coerce.number().int().min(1).max(100).nullable().optional(),
    amountOffMinor: moneyMinor.nullable().optional(),
    freeShipping: z.boolean().optional(),
    minSpendMinor: moneyMinor.nullable().optional(),
    maxDiscountMinor: moneyMinor.nullable().optional(),
    maxUses: z.coerce.number().int().min(1).max(1_000_000).nullable().optional(),
    perUserLimit: z.coerce.number().int().min(1).max(10_000).nullable().optional(),
    stackable: z.boolean().optional(),
    startAt: z.coerce.date().nullable().optional(),
    endAt: z.coerce.date().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'No fields to update.' });

export const couponStatusSchema = z.object({ status: z.enum(COUPON_STATUSES) });

/** Validate a coupon code against a prospective cart total (future-compatible; no wallet mutation). */
export const validateCouponSchema = z.object({
  code: z.string().transform((s) => s.trim().toUpperCase()).pipe(z.string().min(3).max(32)),
  subtotalMinor: moneyMinor,
  vendorProfileId: cuid.nullable().optional(),
});

export type CreateCampaignInput = z.infer<typeof createCampaignSchema>;
export type UpdateCampaignInput = z.infer<typeof updateCampaignSchema>;
export type CampaignScheduleInput = z.infer<typeof campaignScheduleSchema>;
export type CampaignStatusInput = z.infer<typeof campaignStatusSchema>;
export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type SetPlacementsInput = z.infer<typeof setPlacementsSchema>;
export type SetTargetsInput = z.infer<typeof setTargetsSchema>;
export type PromotionAssetPresignInput = z.infer<typeof promotionAssetPresignSchema>;
export type PromotionAssetConfirmInput = z.infer<typeof promotionAssetConfirmSchema>;
export type PromotionOwnerActionInput = z.infer<typeof promotionOwnerActionSchema>;
export type PromotionModerateInput = z.infer<typeof promotionModerateSchema>;
export type PromotionSearchInput = z.infer<typeof promotionSearchSchema>;
export type TrackPromotionEventInput = z.infer<typeof trackPromotionEventSchema>;
export type PromotionReportInput = z.infer<typeof promotionReportSchema>;
export type ResolvePromotionReportInput = z.infer<typeof resolvePromotionReportSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type CreatePlatformCouponInput = z.infer<typeof createPlatformCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponStatusInput = z.infer<typeof couponStatusSchema>;
export type ValidateCouponInput = z.infer<typeof validateCouponSchema>;
