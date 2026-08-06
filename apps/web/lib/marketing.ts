/**
 * Marketing & Business Promotion (M26) — single source of truth for the
 * customer/business-facing marketing UI. Types mirror the API serializers
 * (promotions.service `serveCard`/`ownerCard`/`detail`, campaigns/coupons/analytics),
 * `marketingApi` wraps every endpoint, and the helpers (BZD money in MINOR units,
 * promo window formatting, label lookups) are shared so nothing drifts.
 *
 * Promotions render as ADDITIVE "Sponsored / Featured" placements — this module
 * never reorders organic marketplace/search results. Money is ALWAYS BZD minor units.
 */
import {
  PROMOTION_TYPE_LABELS,
  PROMOTION_STATUS_LABELS,
  PROMOTION_PLACEMENT_LABELS,
  PROMOTION_ASSET_KIND_LABELS,
  PROMOTION_TARGET_TYPE_LABELS,
  CAMPAIGN_TYPE_LABELS,
  CAMPAIGN_STATUS_LABELS,
  COUPON_STATUS_LABELS,
  COUPON_DISCOUNT_TYPE_LABELS,
  computeCtr,
  type PromotionType,
  type PromotionStatus,
  type PromotionPlacementType,
  type PromotionAssetKind,
  type PromotionTargetType,
  type PromotionReportReason,
  type CampaignType,
  type CampaignStatus,
  type CouponStatus,
  type CouponDiscountType,
  type CouponScope,
} from '@bmpl/shared';
import { api } from './api';
import { uploadFile } from './uploads';

/* ------------------------------------------------------------------ types */

/** A resolved target card (promotions.service.resolveTargetCard). Shape varies by
 *  targetType; every field beyond `targetType` is optional so one type covers all. */
export interface ResolvedTarget {
  targetType: PromotionTargetType;
  id?: string;
  label?: string | null;
  slug?: string | null;
  href?: string | null;
  imageUrl?: string | null;
  priceMinor?: number | null;
  currency?: string | null;
  company?: string | null;
  externalUrl?: string | null;
}

export interface PromotionAsset {
  id: string;
  kind: PromotionAssetKind;
  altText: string | null;
  position: number;
  url: string | null;
  videoUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
}

/** Placement row. `id` is present only on the managed/admin detail. */
export interface PromotionPlacement {
  id?: string;
  placement: PromotionPlacementType;
  position: number;
  categoryId: string | null;
}

/** Public serving card (promotions.service.serveCard). */
export interface ServeCard {
  id: string;
  type: PromotionType;
  title: string;
  subtitle: string | null;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  assets: PromotionAsset[];
  placements: PromotionPlacement[];
  target: ResolvedTarget | null;
  targets: ResolvedTarget[];
  publishedAt: string | null;
}

/** Owner/admin list card (promotions.service.ownerCard = serveCard + status flags). */
export interface OwnerPromotionCard extends ServeCard {
  status: PromotionStatus;
  isActive: boolean;
  campaignId: string | null;
  updatedAt: string;
  createdAt: string;
}

export interface PromotionCampaignRef {
  id: string;
  name: string;
  status: CampaignStatus;
}

/** Full promotion detail (promotions.service.detail with moderation). */
export interface PromotionDetail {
  id: string;
  type: PromotionType;
  title: string;
  subtitle: string | null;
  description: string | null;
  status: PromotionStatus;
  priority: number;
  isActive: boolean;
  startAt: string | null;
  endAt: string | null;
  timezone: string;
  campaign: PromotionCampaignRef | null;
  assets: PromotionAsset[];
  placements: PromotionPlacement[];
  targets: ResolvedTarget[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // includeModeration:
  moderationReason?: string | null;
  moderatedById?: string | null;
  submittedAt?: string | null;
  approvedAt?: string | null;
  expiredAt?: string | null;
}

/** Homepage bundle (promotion-discovery.service.homepage). */
export interface HomepageBundle {
  hero: ServeCard[];
  featuredBusinesses: ServeCard[];
  featuredProducts: ServeCard[];
  featuredJobs: ServeCard[];
  featuredProperties: ServeCard[];
}

/* --- campaigns --- */

export interface CampaignCard {
  id: string;
  name: string;
  description: string | null;
  type: CampaignType;
  status: CampaignStatus;
  timezone: string;
  promotionCount: number;
  couponCount: number;
  scheduleCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CampaignSchedule {
  id: string;
  startAt: string;
  endAt: string;
  timezone: string;
}

export interface CampaignStatusHistoryEntry {
  from: CampaignStatus | null;
  to: CampaignStatus;
  note: string | null;
  at: string;
}

export interface CampaignPromotionRef {
  id: string;
  title: string;
  type: PromotionType;
  status: PromotionStatus;
  priority: number;
  isActive: boolean;
}

export interface CampaignDetail extends CampaignCard {
  schedules: CampaignSchedule[];
  statusHistory: CampaignStatusHistoryEntry[];
  promotions: CampaignPromotionRef[];
}

/* --- coupons --- */

export interface Coupon {
  id: string;
  code: string;
  scope: CouponScope;
  vendorProfileId: string | null;
  campaignId: string | null;
  discountType: CouponDiscountType;
  percentOff: number | null;
  amountOffMinor: number | null;
  freeShipping: boolean;
  minSpendMinor: number | null;
  maxDiscountMinor: number | null;
  maxUses: number | null;
  perUserLimit: number | null;
  usedCount: number;
  stackable: boolean;
  status: CouponStatus;
  startAt: string | null;
  endAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CouponValidationResult {
  valid: boolean;
  discountMinor: number;
  freeShipping: boolean;
  reason?: string;
  couponId?: string;
  code?: string;
}

/* --- analytics --- */

export interface MetricTotals {
  impressions: number;
  views: number;
  clicks: number;
  conversions: number;
  ctr: number;
}

export interface TopPromotion {
  id: string;
  title: string;
  type: PromotionType;
  status: PromotionStatus;
  views: number;
  clicks: number;
  impressions: number;
  ctr: number;
}

/** Owner analytics overview (marketing-analytics.service.ownerOverview). */
export interface OwnerAnalytics {
  totalPromotions: number;
  activePromotions: number;
  byStatus: Array<{ status: PromotionStatus; count: number }>;
  totals: MetricTotals;
  campaigns: number;
  coupons: number;
  topPromotions: TopPromotion[];
}

/** Per-promotion analytics (marketing-analytics.service.promotionOverview). */
export interface PromotionAnalytics {
  promotion: { id: string; title: string; type: PromotionType; status: PromotionStatus };
  totals: MetricTotals;
  redemptions: number;
  daily: Array<{ day: string } & MetricTotals>;
  byPlacement: Array<{ placement: PromotionPlacementType | null } & MetricTotals>;
}

/* --- inputs (mirror @bmpl/validation marketing schemas) --- */

export interface PlacementInput {
  placement: PromotionPlacementType;
  position?: number;
  categoryId?: string | null;
}

export interface TargetInput {
  targetType: PromotionTargetType;
  vendorProfileId?: string | null;
  employerProfileId?: string | null;
  agencyProfileId?: string | null;
  agentProfileId?: string | null;
  propertyOwnerProfileId?: string | null;
  productId?: string | null;
  jobListingId?: string | null;
  propertyListingId?: string | null;
  externalUrl?: string | null;
}

export interface CreatePromotionInput {
  type: PromotionType;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  campaignId?: string | null;
  priority?: number;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
  placements?: PlacementInput[];
  targets?: TargetInput[];
}

export interface UpdatePromotionInput {
  title?: string;
  subtitle?: string | null;
  description?: string | null;
  campaignId?: string | null;
  priority?: number;
  startAt?: string | null;
  endAt?: string | null;
  timezone?: string | null;
}

export type PromotionOwnerAction = 'PAUSE' | 'RESUME' | 'ARCHIVE';

export interface CreateCampaignInput {
  name: string;
  description?: string | null;
  type: CampaignType;
  timezone?: string | null;
}
export type UpdateCampaignInput = Partial<CreateCampaignInput>;

export interface CampaignScheduleInput {
  startAt: string;
  endAt: string;
  timezone?: string | null;
}

export interface CreateCouponInput {
  code: string;
  discountType: CouponDiscountType;
  percentOff?: number | null;
  amountOffMinor?: number | null;
  freeShipping?: boolean;
  minSpendMinor?: number | null;
  maxDiscountMinor?: number | null;
  maxUses?: number | null;
  perUserLimit?: number | null;
  stackable?: boolean;
  campaignId?: string | null;
  startAt?: string | null;
  endAt?: string | null;
}

export interface UpdateCouponInput {
  percentOff?: number | null;
  amountOffMinor?: number | null;
  freeShipping?: boolean;
  minSpendMinor?: number | null;
  maxDiscountMinor?: number | null;
  maxUses?: number | null;
  perUserLimit?: number | null;
  stackable?: boolean;
  startAt?: string | null;
  endAt?: string | null;
}

export interface ValidateCouponInput {
  code: string;
  subtotalMinor: number;
  vendorProfileId?: string | null;
}

export type TrackEvent = 'impression' | 'view' | 'click' | 'conversion';

/* --------------------------------------------------------------- helpers */

export const promotionTypeLabel = (t: PromotionType): string => PROMOTION_TYPE_LABELS[t];
export const promotionStatusLabel = (s: PromotionStatus): string => PROMOTION_STATUS_LABELS[s];
export const placementLabel = (p: PromotionPlacementType): string => PROMOTION_PLACEMENT_LABELS[p];
export const assetKindLabel = (k: PromotionAssetKind): string => PROMOTION_ASSET_KIND_LABELS[k];
export const targetTypeLabel = (t: PromotionTargetType): string => PROMOTION_TARGET_TYPE_LABELS[t];
export const campaignTypeLabel = (t: CampaignType): string => CAMPAIGN_TYPE_LABELS[t];
export const campaignStatusLabel = (s: CampaignStatus): string => CAMPAIGN_STATUS_LABELS[s];
export const couponStatusLabel = (s: CouponStatus): string => COUPON_STATUS_LABELS[s];
export const couponDiscountTypeLabel = (t: CouponDiscountType): string => COUPON_DISCOUNT_TYPE_LABELS[t];

export { computeCtr };

/**
 * Money for display. Money is in MINOR units (BZD cents). "BZ$250,000"; whole
 * amounts drop cents. Returns "—" for null/undefined.
 */
export function formatBZD(minor: number | null | undefined): string {
  if (minor == null) return '—';
  const dollars = minor / 100;
  const amount = dollars.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits: dollars % 1 === 0 ? 0 : 2,
  });
  return `BZ$${amount}`;
}

/** A short human-readable discount, e.g. "20% off" or "BZ$10 off" (+ free shipping). */
export function formatDiscount(c: Pick<Coupon, 'discountType' | 'percentOff' | 'amountOffMinor' | 'freeShipping'>): string {
  const parts: string[] = [];
  if (c.discountType === 'PERCENTAGE' && c.percentOff != null) parts.push(`${c.percentOff}% off`);
  else if (c.discountType === 'FIXED_AMOUNT' && c.amountOffMinor != null) parts.push(`${formatBZD(c.amountOffMinor)} off`);
  if (c.freeShipping) parts.push('free shipping');
  return parts.length ? parts.join(' + ') : '—';
}

/** CTR as a percentage string, e.g. "3.2%". */
export function formatCtr(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? '—'
    : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

/** Convert an ISO datetime to the `yyyy-MM-ddThh:mm` value a datetime-local input needs. */
export function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Human-readable serving window. Both null → "Always on"; only end → "Until <date>";
 * only start → "From <date>"; both → "<start> – <end>".
 */
export function formatPromoWindow(startAt: string | null | undefined, endAt: string | null | undefined): string {
  if (!startAt && !endAt) return 'Always on';
  if (startAt && !endAt) return `From ${fmtDate(startAt)}`;
  if (!startAt && endAt) return `Until ${fmtDate(endAt)}`;
  return `${fmtDate(startAt)} – ${fmtDate(endAt)}`;
}

/**
 * Best display asset for a serve card, preferring wide/hero banners then square/logo.
 * Returns the first image (with a URL) matching the preference order, else the first
 * asset with a URL.
 */
export function pickDisplayAsset(assets: PromotionAsset[]): PromotionAsset | null {
  const order: PromotionAssetKind[] = ['DESKTOP_BANNER', 'HERO_IMAGE', 'SQUARE_IMAGE', 'MOBILE_BANNER', 'LOGO'];
  for (const kind of order) {
    const hit = assets.find((a) => a.kind === kind && a.url);
    if (hit) return hit;
  }
  return assets.find((a) => a.url) ?? null;
}

/** Best-effort href for a serve card: primary target href, else its externalUrl. */
export function promoHref(card: ServeCard): string | null {
  const t = card.target;
  if (!t) return null;
  if (t.href) return t.href;
  if (t.externalUrl) return t.externalUrl;
  return null;
}

/* --------------------------------------------------------------- uploads */

interface Presign {
  uploadUrl: string;
  key: string;
}

/**
 * Promotion image asset: upload → confirm (mirrors jobs/realestate). Only image
 * kinds go through here; VIDEO_PLACEHOLDER is confirmed with a URL, not uploaded.
 * Returns the updated managed promotion detail.
 */
export async function uploadPromotionAsset(
  promotionId: string,
  kind: PromotionAssetKind,
  file: File,
  altText?: string,
): Promise<PromotionDetail> {
  const storageKey = await uploadFile(
    `/business/marketing/promotions/${promotionId}/assets/upload?kind=${encodeURIComponent(kind)}`,
    file,
  );
  return api.post<PromotionDetail>(`/business/marketing/promotions/${promotionId}/assets`, {
    kind,
    storageKey,
    altText: altText?.trim() || undefined,
  });
}

/* ------------------------------------------------------------------- api */

function toQuery(params: Record<string, string | number | boolean | undefined | null>): string {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  }
  const s = p.toString();
  return s ? `?${s}` : '';
}

export const marketingApi = {
  /* ---- public serving ---- */
  homepage: () => api.get<HomepageBundle>('/marketing/homepage'),
  placement: (placement: PromotionPlacementType, categoryId?: string) =>
    api.get<ServeCard[]>(`/marketing/placements/${placement}${toQuery({ categoryId })}`),
  publicPromotion: (id: string) => api.get<PromotionDetail>(`/marketing/promotions/${id}`),
  /** Best-effort metric tracking (204). Never throw; never block navigation. */
  track: (id: string, event: TrackEvent, placement?: PromotionPlacementType | null) =>
    api.post(`/marketing/promotions/${id}/track`, { event, placement: placement ?? undefined }),
  report: (id: string, body: { reason: PromotionReportReason; note?: string }) =>
    api.post<{ ok: boolean }>(`/marketing/promotions/${id}/report`, body),
  validateCoupon: (body: ValidateCouponInput) =>
    api.post<CouponValidationResult>('/marketing/coupons/validate', body),

  /* ---- business marketing (VENDOR/EMPLOYER/REAL_ESTATE_AGENT/PROPERTY_OWNER) ---- */
  analytics: () => api.get<OwnerAnalytics>('/business/marketing/analytics'),

  // campaigns
  campaigns: (status?: string) =>
    api.get<CampaignCard[]>(`/business/marketing/campaigns${toQuery({ status })}`),
  campaign: (id: string) => api.get<CampaignDetail>(`/business/marketing/campaigns/${id}`),
  createCampaign: (body: CreateCampaignInput) =>
    api.post<CampaignDetail>('/business/marketing/campaigns', body),
  updateCampaign: (id: string, body: UpdateCampaignInput) =>
    api.patch<CampaignDetail>(`/business/marketing/campaigns/${id}`, body),
  addSchedule: (id: string, body: CampaignScheduleInput) =>
    api.post<CampaignDetail>(`/business/marketing/campaigns/${id}/schedules`, body),
  removeSchedule: (id: string, scheduleId: string) =>
    api.del<CampaignDetail>(`/business/marketing/campaigns/${id}/schedules/${scheduleId}`),
  setCampaignStatus: (id: string, status: CampaignStatus, note?: string) =>
    api.post<CampaignDetail>(`/business/marketing/campaigns/${id}/status`, { status, note: note || undefined }),

  // promotions
  promotions: (status?: string) =>
    api.get<OwnerPromotionCard[]>(`/business/marketing/promotions${toQuery({ status })}`),
  promotion: (id: string) => api.get<PromotionDetail>(`/business/marketing/promotions/${id}`),
  createPromotion: (body: CreatePromotionInput) =>
    api.post<PromotionDetail>('/business/marketing/promotions', body),
  updatePromotion: (id: string, body: UpdatePromotionInput) =>
    api.patch<PromotionDetail>(`/business/marketing/promotions/${id}`, body),
  setPlacements: (id: string, placements: PlacementInput[]) =>
    api.put<PromotionDetail>(`/business/marketing/promotions/${id}/placements`, { placements }),
  setTargets: (id: string, targets: TargetInput[]) =>
    api.put<PromotionDetail>(`/business/marketing/promotions/${id}/targets`, { targets }),
  uploadAsset: uploadPromotionAsset,
  confirmVideoAsset: (id: string, videoUrl: string, altText?: string) =>
    api.post<PromotionDetail>(`/business/marketing/promotions/${id}/assets`, {
      kind: 'VIDEO_PLACEHOLDER',
      videoUrl,
      altText: altText?.trim() || undefined,
    }),
  deleteAsset: (id: string, assetId: string) =>
    api.del<PromotionDetail>(`/business/marketing/promotions/${id}/assets/${assetId}`),
  submitPromotion: (id: string) =>
    api.post<PromotionDetail>(`/business/marketing/promotions/${id}/submit`),
  setPromotionStatus: (id: string, action: PromotionOwnerAction) =>
    api.post<PromotionDetail>(`/business/marketing/promotions/${id}/status`, { action }),
  promotionAnalytics: (id: string) =>
    api.get<PromotionAnalytics>(`/business/marketing/promotions/${id}/analytics`),

  // coupons (vendor-scoped)
  coupons: (status?: string) =>
    api.get<Coupon[]>(`/business/marketing/coupons${toQuery({ status })}`),
  coupon: (id: string) => api.get<Coupon>(`/business/marketing/coupons/${id}`),
  createCoupon: (body: CreateCouponInput) => api.post<Coupon>('/business/marketing/coupons', body),
  updateCoupon: (id: string, body: UpdateCouponInput) =>
    api.patch<Coupon>(`/business/marketing/coupons/${id}`, body),
  setCouponStatus: (id: string, status: CouponStatus) =>
    api.post<Coupon>(`/business/marketing/coupons/${id}/status`, { status }),
};
