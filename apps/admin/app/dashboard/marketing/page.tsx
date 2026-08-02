'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  PROMOTION_TYPES,
  PROMOTION_TYPE_LABELS,
  PROMOTION_STATUSES,
  PROMOTION_STATUS_LABELS,
  PROMOTION_PLACEMENT_LABELS,
  PROMOTION_TARGET_TYPE_LABELS,
  PROMOTION_ASSET_KIND_LABELS,
  PROMOTION_REPORT_REASON_LABELS,
  PROMOTION_REPORT_STATUSES,
  CAMPAIGN_STATUSES,
  CAMPAIGN_STATUS_LABELS,
  CAMPAIGN_TYPE_LABELS,
  CAMPAIGN_TRANSITIONS,
  COUPON_DISCOUNT_TYPES,
  COUPON_DISCOUNT_TYPE_LABELS,
  COUPON_STATUSES,
  COUPON_STATUS_LABELS,
  COUPON_SCOPES,
  HOMEPAGE_PLACEMENTS,
  type PromotionType,
  type PromotionStatus,
  type PromotionPlacementType,
  type PromotionTargetType,
  type PromotionAssetKind,
  type PromotionReportReason,
  type PromotionReportStatus,
  type PromotionModerationAction,
  type CampaignStatus,
  type CampaignType,
  type CouponDiscountType,
  type CouponStatus,
  type CouponScope,
} from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../../../components/ui';

/**
 * Marketing & Business Promotion admin console — M26. Client shapes mirror the
 * documented GET /admin/marketing/* responses (see promotions.service adminList/
 * adminDetail, campaigns.service adminList, coupons.service adminList,
 * marketing-admin.service reports/homepage, marketing-analytics adminOverview).
 * Money is in MINOR units (BZD cents); labels come from @bmpl/shared so
 * admin/web/api never drift. Every write endpoint is permission-gated server-side
 * and degrades gracefully on a 403 (read views show a forbidden state; actions
 * surface the server's 403 message).
 */

type ListState = 'loading' | 'ready' | 'error' | 'forbidden';

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function apiMessage(err: unknown, fallback: string): string {
  if (apiStatus(err) === 403) return "You don't have permission to perform this action.";
  return (typeof err === 'object' && err !== null && (err as ApiError).message) || fallback;
}

function num(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Minor units (cents) → BZD dollars string. */
function moneyMinor(minor: number): string {
  return `BZD ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function promotionTypeLabel(s: string): string {
  return PROMOTION_TYPE_LABELS[s as PromotionType] ?? s.replace(/_/g, ' ');
}
function promotionStatusLabel(s: string): string {
  return PROMOTION_STATUS_LABELS[s as PromotionStatus] ?? s.replace(/_/g, ' ');
}
function placementLabel(s: string): string {
  return PROMOTION_PLACEMENT_LABELS[s as PromotionPlacementType] ?? s.replace(/_/g, ' ');
}
function targetTypeLabel(s: string): string {
  return PROMOTION_TARGET_TYPE_LABELS[s as PromotionTargetType] ?? s.replace(/_/g, ' ');
}
function campaignStatusLabel(s: string): string {
  return CAMPAIGN_STATUS_LABELS[s as CampaignStatus] ?? s.replace(/_/g, ' ');
}
function campaignTypeLabel(s: string): string {
  return CAMPAIGN_TYPE_LABELS[s as CampaignType] ?? s.replace(/_/g, ' ');
}
function couponStatusLabel(s: string): string {
  return COUPON_STATUS_LABELS[s as CouponStatus] ?? s.replace(/_/g, ' ');
}

/* ------------------------------------------------------------------ */
/* Response shapes (mirror the API serializers)                        */
/* ------------------------------------------------------------------ */

interface PromotionTargetCard {
  targetType: PromotionTargetType;
  id?: string;
  label?: string;
  slug?: string;
  href?: string;
  imageUrl?: string | null;
  priceMinor?: number | null;
  currency?: string;
  company?: string;
  externalUrl?: string | null;
}

interface PromotionAsset {
  id: string;
  kind: PromotionAssetKind;
  altText: string | null;
  position: number;
  url: string | null;
  videoUrl: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
}

interface PromotionPlacementCard {
  placement: PromotionPlacementType;
  position: number;
  categoryId: string | null;
}

interface PromotionListItem {
  id: string;
  type: PromotionType;
  title: string;
  subtitle: string | null;
  priority: number;
  startAt: string | null;
  endAt: string | null;
  assets: PromotionAsset[];
  placements: PromotionPlacementCard[];
  target: PromotionTargetCard | null;
  targets: PromotionTargetCard[];
  publishedAt: string | null;
  status: PromotionStatus;
  isActive: boolean;
  campaignId: string | null;
  updatedAt: string;
  createdAt: string;
  moderationReason: string | null;
  ownerEmail: string | null;
  reportCount: number;
}

interface PromotionDetail {
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
  campaign: { id: string; name: string; status: string } | null;
  assets: PromotionAsset[];
  placements: Array<PromotionPlacementCard & { id: string }>;
  targets: PromotionTargetCard[];
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  moderationReason: string | null;
  moderatedById: string | null;
  submittedAt: string | null;
  approvedAt: string | null;
  expiredAt: string | null;
}

interface PromotionReportItem {
  id: string;
  promotionId: string;
  reason: PromotionReportReason;
  note: string | null;
  status: PromotionReportStatus;
  createdAt: string;
  promotion: { id: string; title: string; type: PromotionType; status: PromotionStatus };
}

interface CampaignListItem {
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
  ownerEmail: string | null;
}

interface CouponItem {
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
  vendor?: { businessName: string; slug: string } | null;
  usageCount?: number;
}

interface HomepageItem {
  promotionId: string;
  title: string;
  type: PromotionType;
  status: PromotionStatus;
  isActive: boolean;
  priority: number;
  position: number;
}

interface HomepageCuration {
  placements: Record<string, HomepageItem[]>;
}

interface MarketingAnalytics {
  servingNow: number;
  pendingModeration: number;
  openReports: number;
  byStatus: Array<{ status: string; count: number }>;
  byType: Array<{ type: string; count: number }>;
  totals: { impressions: number; views: number; clicks: number; conversions: number; ctr: number };
  activeCampaigns: number;
  activeCoupons: number;
  topPromotions: Array<{ id: string; title: string; type: string; status: string; views: number; clicks: number; impressions: number; ctr: number }>;
}

/* ------------------------------------------------------------------ */
/* Page shell                                                          */
/* ------------------------------------------------------------------ */

type Tab = 'moderation' | 'promotions' | 'campaigns' | 'coupons' | 'homepage' | 'reports' | 'analytics';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'moderation', label: 'Moderation queue' },
  { key: 'promotions', label: 'All promotions' },
  { key: 'campaigns', label: 'Campaigns' },
  { key: 'coupons', label: 'Coupons' },
  { key: 'homepage', label: 'Homepage' },
  { key: 'reports', label: 'Reports' },
  { key: 'analytics', label: 'Analytics' },
];

export default function MarketingPage() {
  const [tab, setTab] = useState<Tab>('moderation');

  return (
    <div>
      <PageHeader
        eyebrow="Marketing"
        title="Marketing & business promotion"
        description="Moderate promotions, oversee campaigns and platform coupons, curate the homepage, resolve abuse reports, and track marketing performance."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Marketing views">
        {TABS.map((t) => {
          const active = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setTab(t.key)}
              className={`rounded-full px-3.5 py-1.5 text-sm font-semibold transition ${
                active
                  ? 'bg-belize-blue text-white shadow-bmpl-sm'
                  : 'border border-slate-300 text-belize-navy hover:border-belize-blue hover:bg-belize-blue/5'
              }`}
            >
              {t.label}
            </button>
          );
        })}
      </div>

      {tab === 'moderation' && <PromotionsTab key="moderation" queue />}
      {tab === 'promotions' && <PromotionsTab key="promotions" queue={false} />}
      {tab === 'campaigns' && <CampaignsTab />}
      {tab === 'coupons' && <CouponsTab />}
      {tab === 'homepage' && <HomepageTab />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Promotions (moderation queue + all promotions)                      */
/* ------------------------------------------------------------------ */

const QUEUE_STATUSES: readonly PromotionStatus[] = ['SUBMITTED', 'UNDER_REVIEW'];

const QUEUE_STATUS_OPTIONS: Array<{ value: PromotionStatus | ''; label: string }> = [
  { value: '', label: 'All pending' },
  ...QUEUE_STATUSES.map((s) => ({ value: s, label: PROMOTION_STATUS_LABELS[s] })),
];

const ALL_STATUS_OPTIONS: Array<{ value: PromotionStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...PROMOTION_STATUSES.map((s) => ({ value: s, label: PROMOTION_STATUS_LABELS[s] })),
];

const TYPE_OPTIONS: Array<{ value: PromotionType | ''; label: string }> = [
  { value: '', label: 'All types' },
  ...PROMOTION_TYPES.map((t) => ({ value: t, label: PROMOTION_TYPE_LABELS[t] })),
];

function PromotionsTab({ queue }: { queue: boolean }) {
  const [status, setStatus] = useState<PromotionStatus | ''>('');
  const [type, setType] = useState<PromotionType | ''>('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [items, setItems] = useState<PromotionListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const options = queue ? QUEUE_STATUS_OPTIONS : ALL_STATUS_OPTIONS;

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (type) params.set('type', type);
      if (reportedOnly) params.set('reported', 'true');
      const qs = params.toString();
      let rows = await api.get<PromotionListItem[]>(`/admin/marketing/promotions${qs ? `?${qs}` : ''}`);
      // In moderation mode with no specific status, restrict to the pending queue.
      if (queue && !status) rows = rows.filter((r) => QUEUE_STATUSES.includes(r.status));
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status, type, reportedOnly, queue]);

  useEffect(() => {
    void load();
  }, [load]);

  const onUpdated = useCallback(
    (updated: PromotionDetail) => {
      setItems((prev) => {
        const mapped = prev.map((p) =>
          p.id === updated.id
            ? { ...p, status: updated.status, isActive: updated.isActive, priority: updated.priority, moderationReason: updated.moderationReason }
            : p,
        );
        return queue && !status ? mapped.filter((p) => QUEUE_STATUSES.includes(p.status)) : mapped;
      });
      setNotice(`"${updated.title}" set to ${promotionStatusLabel(updated.status)}.`);
    },
    [queue, status],
  );

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>promotions.read</code> permission required to view promotions.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="promotion-status">
            <Select id="promotion-status" value={status} onChange={(e) => setStatus(e.target.value as PromotionStatus | '')}>
              {options.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[12rem]">
          <Field label="Type" htmlFor="promotion-type">
            <Select id="promotion-type" value={type} onChange={(e) => setType(e.target.value as PromotionType | '')}>
              {TYPE_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex cursor-pointer items-center gap-2 pb-2 text-sm font-medium text-belize-navy">
          <input
            type="checkbox"
            checked={reportedOnly}
            onChange={(e) => setReportedOnly(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue"
          />
          Reported only
        </label>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="rounded-bmpl-xl border border-slate-200 bg-white">
          {listState === 'loading' ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading promotions…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load promotions.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No promotions" description={queue ? 'No promotions are awaiting moderation.' : 'No promotions match the current filters.'} />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((p) => {
                const active = p.id === selectedId;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(p.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                        active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{p.title}</span>
                        <StatusBadge status={p.status} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
                        <span>{promotionTypeLabel(p.type)}</span>
                        {p.target?.label && (
                          <>
                            <span aria-hidden>·</span>
                            <span className="truncate">{p.target.label}</span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        <span>Priority {num(p.priority)}</span>
                        {p.isActive && <Badge tone="success">Live</Badge>}
                        {p.reportCount > 0 && (
                          <Badge tone="error">
                            {num(p.reportCount)} {p.reportCount === 1 ? 'report' : 'reports'}
                          </Badge>
                        )}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId ? (
          <PromotionDetailPanel key={selectedId} id={selectedId} onUpdated={onUpdated} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No promotion selected" description="Choose a promotion from the list to review its content." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ---- moderation actions (mirror promotions.service.moderate rules) ---- */

const REASON_REQUIRED: Record<PromotionModerationAction, boolean> = {
  APPROVE: false,
  REJECT: true,
  REQUEST_INFO: true,
  PAUSE: false,
  EXPIRE: false,
  ARCHIVE: false,
  RESTORE: false,
};

const ACTION_LABELS: Record<PromotionModerationAction, string> = {
  APPROVE: 'Approve & publish',
  REJECT: 'Reject',
  REQUEST_INFO: 'Request info',
  PAUSE: 'Pause',
  EXPIRE: 'Expire',
  ARCHIVE: 'Archive',
  RESTORE: 'Restore',
};

function availableActions(status: PromotionStatus): PromotionModerationAction[] {
  switch (status) {
    case 'SUBMITTED':
    case 'UNDER_REVIEW':
      return ['APPROVE', 'REQUEST_INFO', 'REJECT'];
    case 'APPROVED':
      return ['PAUSE', 'EXPIRE', 'ARCHIVE'];
    case 'PAUSED':
      return ['RESTORE', 'EXPIRE', 'ARCHIVE'];
    case 'EXPIRED':
    case 'REJECTED':
      return ['RESTORE', 'ARCHIVE'];
    case 'ARCHIVED':
      return ['RESTORE'];
    case 'MORE_INFO_REQUIRED':
    case 'DRAFT':
      return ['ARCHIVE'];
    default:
      return [];
  }
}

function promotionWindow(p: { startAt: string | null; endAt: string | null }): string | null {
  if (!p.startAt && !p.endAt) return null;
  const fmt = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString() : '—');
  return `${fmt(p.startAt)} → ${fmt(p.endAt)}`;
}

function PromotionDetailPanel({ id, onUpdated }: { id: string; onUpdated: (p: PromotionDetail) => void }) {
  const [detail, setDetail] = useState<PromotionDetail | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [pending, setPending] = useState<PromotionModerationAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // priority / feature control
  const [priority, setPriority] = useState('');
  const [prioBusy, setPrioBusy] = useState(false);
  const [prioError, setPrioError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<PromotionDetail>(`/admin/marketing/promotions/${id}`);
      setDetail(d);
      setPriority(String(d.priority));
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: PromotionModerationAction) {
    const trimmed = reason.trim();
    if (REASON_REQUIRED[action] && !trimmed) {
      setError('A reason is required for this action.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<PromotionDetail>(`/admin/marketing/promotions/${id}/moderate`, {
        action,
        ...(trimmed ? { reason: trimmed } : {}),
      });
      setDetail(updated);
      setPriority(String(updated.priority));
      setPending(null);
      setReason('');
      onUpdated(updated);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the promotions.moderate permission." : apiMessage(err, 'Action failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function applyPriority(isActive?: boolean) {
    setPrioBusy(true);
    setPrioError(null);
    try {
      const body: { priority?: number; isActive?: boolean } = {};
      const parsed = Number(priority);
      if (priority.trim() !== '' && Number.isFinite(parsed)) body.priority = Math.trunc(parsed);
      if (isActive !== undefined) body.isActive = isActive;
      const updated = await api.post<PromotionDetail>(`/admin/marketing/promotions/${id}/priority`, body);
      setDetail(updated);
      setPriority(String(updated.priority));
      onUpdated(updated);
    } catch (err) {
      setPrioError(apiStatus(err) === 403 ? "You don't have the promotions.manage permission." : apiMessage(err, 'Could not update priority.'));
    } finally {
      setPrioBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading promotion…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="You don't have permission">
          You do not have the <code>promotions.read</code> permission required to view this promotion.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this promotion.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const actions = availableActions(detail.status);
  const window = promotionWindow(detail);

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-belize-navy">{detail.title}</h2>
          <StatusBadge status={detail.status} />
          {detail.isActive && <Badge tone="success">Live</Badge>}
        </div>
        {detail.subtitle && <p className="mt-1 text-sm text-slate-500">{detail.subtitle}</p>}
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{promotionTypeLabel(detail.type)}</Badge>
          <Badge tone="neutral">Priority {num(detail.priority)}</Badge>
          {detail.campaign && <Badge tone="info">Campaign: {detail.campaign.name}</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {window && <span>{window}</span>}
          <span>TZ {detail.timezone}</span>
          {detail.publishedAt && <span>Published {relativeTime(detail.publishedAt)}</span>}
          {detail.submittedAt && <span>Submitted {relativeTime(detail.submittedAt)}</span>}
          <span>Created {relativeTime(detail.createdAt)}</span>
        </div>
      </div>

      {detail.moderationReason && (
        <div className="p-4 pb-0">
          <Alert tone="warning" title="Moderation reason">
            {detail.moderationReason}
          </Alert>
        </div>
      )}

      <div className="space-y-4 p-4">
        {detail.description && <ExpandableText label="Description" text={detail.description} />}

        {detail.targets.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Targets</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.targets.map((t, i) => (
                <Badge key={`${t.targetType}-${t.id ?? i}`} tone="neutral">
                  {targetTypeLabel(t.targetType)}
                  {t.label ? `: ${t.label}` : t.externalUrl ? `: ${t.externalUrl}` : ''}
                  {t.priceMinor != null ? ` · ${moneyMinor(t.priceMinor)}` : ''}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.placements.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Placements</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.placements.map((pl) => (
                <Badge key={pl.id} tone="info">
                  {placementLabel(pl.placement)}
                  {` · #${num(pl.position)}`}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.assets.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Assets ({num(detail.assets.length)})</p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {detail.assets.map((a) =>
                a.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={a.id}
                    src={a.url}
                    alt={a.altText ?? PROMOTION_ASSET_KIND_LABELS[a.kind] ?? 'Promotion asset'}
                    className="aspect-square w-full rounded-bmpl-md border border-slate-200 object-cover"
                  />
                ) : (
                  <div key={a.id} className="flex aspect-square w-full flex-col items-center justify-center rounded-bmpl-md border border-slate-200 bg-slate-50 p-2 text-center text-xs text-slate-400">
                    <span className="font-semibold">{PROMOTION_ASSET_KIND_LABELS[a.kind] ?? a.kind}</span>
                    {a.videoUrl && <span className="mt-1 break-all">video</span>}
                  </div>
                ),
              )}
            </div>
          </div>
        )}
      </div>

      {/* Priority / feature control */}
      <div className="border-t border-slate-100 p-4">
        <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">Priority &amp; feature</p>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-32">
            <Field label="Priority (0–1000)" htmlFor={`priority-${id}`}>
              <Input
                id={`priority-${id}`}
                type="number"
                min={0}
                max={1000}
                value={priority}
                onChange={(e) => setPriority(e.target.value)}
              />
            </Field>
          </div>
          <Button size="sm" variant="outline" disabled={prioBusy} onClick={() => void applyPriority()}>
            {prioBusy ? <Spinner className="h-4 w-4" /> : 'Save priority'}
          </Button>
          {detail.status === 'APPROVED' &&
            (detail.isActive ? (
              <Button size="sm" variant="destructive" disabled={prioBusy} onClick={() => void applyPriority(false)}>
                Unfeature (hide)
              </Button>
            ) : (
              <Button size="sm" disabled={prioBusy} onClick={() => void applyPriority(true)}>
                Feature (serve)
              </Button>
            ))}
        </div>
        {prioError && (
          <div className="mt-2">
            <Alert tone="error">{prioError}</Alert>
          </div>
        )}
      </div>

      {error && (
        <div className="px-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Moderation actions */}
      <div className="border-t border-slate-100 p-4">
        {actions.length === 0 ? (
          <p className="text-sm text-slate-400">No moderation actions available for this status.</p>
        ) : pending ? (
          <div className="space-y-2">
            <Field
              label={REASON_REQUIRED[pending] ? 'Reason (required)' : 'Reason (optional)'}
              htmlFor={`reason-${id}`}
              hint="Shared with the owner in the moderation notice. Up to 1000 characters."
            >
              <Textarea
                id={`reason-${id}`}
                rows={2}
                maxLength={1000}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder={REASON_REQUIRED[pending] ? 'Explain why…' : 'Add an optional reason…'}
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={pending === 'REJECT' || pending === 'EXPIRE' || pending === 'ARCHIVE' ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void submit(pending)}
              >
                {busy ? (
                  <>
                    <Spinner className="h-4 w-4" /> Working…
                  </>
                ) : (
                  `Confirm ${ACTION_LABELS[pending].toLowerCase()}`
                )}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={busy}
                onClick={() => {
                  setPending(null);
                  setReason('');
                  setError(null);
                }}
              >
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {actions.map((a) => (
              <Button
                key={a}
                size="sm"
                variant={a === 'APPROVE' || a === 'RESTORE' ? 'primary' : a === 'REJECT' || a === 'EXPIRE' || a === 'ARCHIVE' ? 'destructive' : 'outline'}
                onClick={() => {
                  setPending(a);
                  setReason('');
                  setError(null);
                }}
              >
                {ACTION_LABELS[a]}
              </Button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ExpandableText({ label, text }: { label: string; text: string }) {
  const [expanded, setExpanded] = useState(false);
  const long = text.length > 320;
  const shown = expanded || !long ? text : `${text.slice(0, 320)}…`;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</p>
      <p className="whitespace-pre-wrap break-words text-sm text-belize-navy">{shown}</p>
      {long && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold text-belize-blue underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Campaigns                                                           */
/* ------------------------------------------------------------------ */

const CAMPAIGN_STATUS_OPTIONS: Array<{ value: CampaignStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...CAMPAIGN_STATUSES.map((s) => ({ value: s, label: CAMPAIGN_STATUS_LABELS[s] })),
];

function CampaignsTab() {
  const [status, setStatus] = useState<CampaignStatus | ''>('');
  const [items, setItems] = useState<CampaignListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const qs = status ? `?status=${status}` : '';
      const rows = await api.get<CampaignListItem[]>(`/admin/marketing/campaigns${qs}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = useCallback((id: string, next: CampaignStatus) => {
    setItems((prev) => prev.map((c) => (c.id === id ? { ...c, status: next } : c)));
    setNotice(`Campaign set to ${campaignStatusLabel(next)}.`);
  }, []);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>promotions.read</code> permission required to view campaigns.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="campaign-status">
            <Select id="campaign-status" value={status} onChange={(e) => setStatus(e.target.value as CampaignStatus | '')}>
              {CAMPAIGN_STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading campaigns…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load campaigns.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No campaigns" description="No campaigns match the current filter." />
      ) : (
        <ul className="space-y-4">
          {items.map((c) => (
            <CampaignCard key={c.id} campaign={c} onChanged={onChanged} />
          ))}
        </ul>
      )}
    </div>
  );
}

function CampaignCard({ campaign, onChanged }: { campaign: CampaignListItem; onChanged: (id: string, next: CampaignStatus) => void }) {
  const [pending, setPending] = useState<CampaignStatus | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const transitions = CAMPAIGN_TRANSITIONS[campaign.status] ?? [];

  async function submit(next: CampaignStatus) {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await api.post(`/admin/marketing/campaigns/${campaign.id}/status`, { status: next, ...(trimmed ? { note: trimmed } : {}) });
      onChanged(campaign.id, next);
      setPending(null);
      setNote('');
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the campaigns.manage permission." : apiMessage(err, 'Action failed. Please try again.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-belize-navy">{campaign.name}</span>
          <StatusBadge status={campaign.status} />
          <Badge tone="brand">{campaignTypeLabel(campaign.type)}</Badge>
        </div>
        <span className="shrink-0 text-xs text-slate-400">Updated {relativeTime(campaign.updatedAt)}</span>
      </div>

      {campaign.description && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{campaign.description}</p>}

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        <span>{num(campaign.promotionCount)} promotions</span>
        <span>{num(campaign.couponCount)} coupons</span>
        <span>{num(campaign.scheduleCount)} schedules</span>
        {campaign.ownerEmail && <span>Owner {campaign.ownerEmail}</span>}
        <span>TZ {campaign.timezone}</span>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {transitions.length > 0 && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {pending ? (
            <div className="space-y-2">
              <Field label="Optional note" htmlFor={`campaign-note-${campaign.id}`} hint="Recorded in the campaign status history. Up to 1000 characters.">
                <Textarea
                  id={`campaign-note-${campaign.id}`}
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note (optional)…"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" disabled={busy} onClick={() => void submit(pending)}>
                  {busy ? (
                    <>
                      <Spinner className="h-4 w-4" /> Working…
                    </>
                  ) : (
                    `Confirm → ${campaignStatusLabel(pending)}`
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setNote('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Transition to:</span>
              {transitions.map((t) => (
                <Button
                  key={t}
                  size="sm"
                  variant={t === 'ARCHIVED' || t === 'EXPIRED' ? 'destructive' : 'outline'}
                  onClick={() => {
                    setPending(t);
                    setNote('');
                    setError(null);
                  }}
                >
                  {campaignStatusLabel(t)}
                </Button>
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Coupons                                                             */
/* ------------------------------------------------------------------ */

const COUPON_SCOPE_OPTIONS: Array<{ value: CouponScope | ''; label: string }> = [
  { value: '', label: 'All scopes' },
  { value: 'PLATFORM', label: 'Platform' },
  { value: 'VENDOR', label: 'Vendor' },
];

const COUPON_STATUS_FILTER_OPTIONS: Array<{ value: CouponStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...COUPON_STATUSES.map((s) => ({ value: s, label: COUPON_STATUS_LABELS[s] })),
];

interface CouponFormState {
  code: string;
  scope: CouponScope;
  discountType: CouponDiscountType;
  percentOff: string;
  amountOff: string; // dollars, converted to minor on submit
  minSpend: string;
  maxDiscount: string;
  maxUses: string;
  perUserLimit: string;
  freeShipping: boolean;
  stackable: boolean;
  startAt: string;
  endAt: string;
}

function emptyCouponForm(): CouponFormState {
  return {
    code: '',
    scope: 'PLATFORM',
    discountType: 'PERCENTAGE',
    percentOff: '',
    amountOff: '',
    minSpend: '',
    maxDiscount: '',
    maxUses: '',
    perUserLimit: '',
    freeShipping: false,
    stackable: false,
    startAt: '',
    endAt: '',
  };
}

function toMinorOrNull(dollars: string): number | null {
  const v = dollars.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

function toIntOrNull(s: string): number | null {
  const v = s.trim();
  if (v === '') return null;
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.trunc(n);
}

function CouponsTab() {
  const [scope, setScope] = useState<CouponScope | ''>('');
  const [status, setStatus] = useState<CouponStatus | ''>('');
  const [items, setItems] = useState<CouponItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const params = new URLSearchParams();
      if (scope) params.set('scope', scope);
      if (status) params.set('status', status);
      const qs = params.toString();
      const rows = await api.get<CouponItem[]>(`/admin/marketing/coupons${qs ? `?${qs}` : ''}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [scope, status]);

  useEffect(() => {
    void load();
  }, [load]);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>coupons.manage</code> permission required to view coupons.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="flex flex-wrap items-end gap-4">
          <div className="min-w-[10rem]">
            <Field label="Scope" htmlFor="coupon-scope">
              <Select id="coupon-scope" value={scope} onChange={(e) => setScope(e.target.value as CouponScope | '')}>
                {COUPON_SCOPE_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          <div className="min-w-[10rem]">
            <Field label="Status" htmlFor="coupon-status">
              <Select id="coupon-status" value={status} onChange={(e) => setStatus(e.target.value as CouponStatus | '')}>
                {COUPON_STATUS_FILTER_OPTIONS.map((o) => (
                  <option key={o.value || 'all'} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <Button size="sm" onClick={() => setEditing((e) => (e === 'new' ? null : 'new'))}>
          {editing === 'new' ? 'Close' : 'New platform coupon'}
        </Button>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {editing === 'new' && (
        <CouponForm
          mode="create"
          onCancel={() => setEditing(null)}
          onSaved={(c) => {
            setItems((prev) => [c, ...prev]);
            setEditing(null);
            setNotice(`Coupon ${c.code} created (starts inactive).`);
          }}
        />
      )}

      {listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading coupons…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load coupons.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No coupons" description="No coupons match the current filter." />
      ) : (
        <ul className="space-y-3">
          {items.map((c) => (
            <CouponRow
              key={c.id}
              coupon={c}
              editing={editing === c.id}
              onToggleEdit={() => setEditing((e) => (e === c.id ? null : c.id))}
              onChanged={(updated) => {
                setItems((prev) => prev.map((x) => (x.id === updated.id ? { ...x, ...updated } : x)));
                setEditing(null);
                setNotice(`Coupon ${updated.code} updated.`);
              }}
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function couponDiscountLabel(c: CouponItem): string {
  if (c.discountType === 'PERCENTAGE') return `${c.percentOff ?? 0}% off`;
  return `${moneyMinor(c.amountOffMinor ?? 0)} off`;
}

function CouponRow({
  coupon,
  editing,
  onToggleEdit,
  onChanged,
}: {
  coupon: CouponItem;
  editing: boolean;
  onToggleEdit: () => void;
  onChanged: (c: CouponItem) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function setStatus(next: CouponStatus) {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<CouponItem>(`/admin/marketing/coupons/${coupon.id}/status`, { status: next });
      onChanged({ ...coupon, ...updated });
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the coupons.manage permission." : apiMessage(err, 'Could not change status.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="font-mono text-sm font-semibold text-belize-navy">{coupon.code}</span>
          <StatusBadge status={coupon.status} />
          <Badge tone={coupon.scope === 'PLATFORM' ? 'brand' : 'neutral'}>{coupon.scope}</Badge>
          <Badge tone="info">{couponDiscountLabel(coupon)}</Badge>
          {coupon.freeShipping && <Badge tone="success">Free shipping</Badge>}
          {coupon.stackable && <Badge tone="neutral">Stackable</Badge>}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button size="sm" variant="outline" onClick={onToggleEdit}>
            {editing ? 'Close' : 'Edit'}
          </Button>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
        {coupon.minSpendMinor != null && <span>Min spend {moneyMinor(coupon.minSpendMinor)}</span>}
        {coupon.maxDiscountMinor != null && <span>Max discount {moneyMinor(coupon.maxDiscountMinor)}</span>}
        {coupon.maxUses != null && <span>Max uses {num(coupon.maxUses)}</span>}
        {coupon.perUserLimit != null && <span>Per user {num(coupon.perUserLimit)}</span>}
        <span>
          Used {num(coupon.usedCount)}
          {coupon.usageCount != null ? ` · ${num(coupon.usageCount)} usages` : ''}
        </span>
        {coupon.vendor && <span>Vendor {coupon.vendor.businessName}</span>}
        {coupon.startAt && <span>Starts {new Date(coupon.startAt).toLocaleDateString()}</span>}
        {coupon.endAt && <span>Ends {new Date(coupon.endAt).toLocaleDateString()}</span>}
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        {COUPON_STATUSES.filter((s) => s !== coupon.status).map((s) => (
          <Button
            key={s}
            size="sm"
            variant={s === 'ACTIVE' ? 'primary' : s === 'DISABLED' ? 'destructive' : 'outline'}
            disabled={busy}
            onClick={() => void setStatus(s)}
          >
            {busy ? <Spinner className="h-4 w-4" /> : `Set ${couponStatusLabel(s)}`}
          </Button>
        ))}
      </div>

      {editing && (
        <div className="mt-3 border-t border-slate-100 pt-3">
          <CouponForm
            mode="edit"
            coupon={coupon}
            onCancel={onToggleEdit}
            onSaved={(c) => onChanged(c)}
          />
        </div>
      )}
    </li>
  );
}

function CouponForm({
  mode,
  coupon,
  onSaved,
  onCancel,
}: {
  mode: 'create' | 'edit';
  coupon?: CouponItem;
  onSaved: (c: CouponItem) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<CouponFormState>(() => {
    if (coupon) {
      return {
        code: coupon.code,
        scope: coupon.scope,
        discountType: coupon.discountType,
        percentOff: coupon.percentOff != null ? String(coupon.percentOff) : '',
        amountOff: coupon.amountOffMinor != null ? String(coupon.amountOffMinor / 100) : '',
        minSpend: coupon.minSpendMinor != null ? String(coupon.minSpendMinor / 100) : '',
        maxDiscount: coupon.maxDiscountMinor != null ? String(coupon.maxDiscountMinor / 100) : '',
        maxUses: coupon.maxUses != null ? String(coupon.maxUses) : '',
        perUserLimit: coupon.perUserLimit != null ? String(coupon.perUserLimit) : '',
        freeShipping: coupon.freeShipping,
        stackable: coupon.stackable,
        startAt: coupon.startAt ? coupon.startAt.slice(0, 10) : '',
        endAt: coupon.endAt ? coupon.endAt.slice(0, 10) : '',
      };
    }
    return emptyCouponForm();
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set<K extends keyof CouponFormState>(key: K, value: CouponFormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const isPct = form.discountType === 'PERCENTAGE';
      const percentOff = isPct ? toIntOrNull(form.percentOff) : null;
      const amountOffMinor = isPct ? null : toMinorOrNull(form.amountOff);
      const common = {
        discountType: form.discountType,
        percentOff,
        amountOffMinor,
        freeShipping: form.freeShipping,
        stackable: form.stackable,
        minSpendMinor: toMinorOrNull(form.minSpend),
        maxDiscountMinor: toMinorOrNull(form.maxDiscount),
        maxUses: toIntOrNull(form.maxUses),
        perUserLimit: toIntOrNull(form.perUserLimit),
        startAt: form.startAt ? new Date(form.startAt).toISOString() : null,
        endAt: form.endAt ? new Date(form.endAt).toISOString() : null,
      };
      let saved: CouponItem;
      if (mode === 'create') {
        saved = await api.post<CouponItem>('/admin/marketing/coupons', {
          code: form.code.trim().toUpperCase(),
          scope: form.scope,
          ...common,
        });
      } else if (coupon) {
        // PATCH does not change code/scope; discount fields + limits only.
        saved = await api.patch<CouponItem>(`/admin/marketing/coupons/${coupon.id}`, common);
      } else {
        return;
      }
      onSaved(saved);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the coupons.manage permission." : apiMessage(err, 'Could not save the coupon.'));
    } finally {
      setBusy(false);
    }
  }

  const isPct = form.discountType === 'PERCENTAGE';

  return (
    <div className="space-y-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-4">
      <p className="text-sm font-semibold text-belize-navy">{mode === 'create' ? 'New platform coupon' : `Edit ${coupon?.code ?? 'coupon'}`}</p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {mode === 'create' && (
          <>
            <Field label="Code" htmlFor="cf-code" hint="3–32 chars, A–Z 0–9 and dashes.">
              <Input id="cf-code" value={form.code} onChange={(e) => set('code', e.target.value.toUpperCase())} placeholder="SAVE10" />
            </Field>
            <Field label="Scope" htmlFor="cf-scope">
              <Select id="cf-scope" value={form.scope} onChange={(e) => set('scope', e.target.value as CouponScope)}>
                {COUPON_SCOPES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        )}

        <Field label="Discount type" htmlFor="cf-type">
          <Select id="cf-type" value={form.discountType} onChange={(e) => set('discountType', e.target.value as CouponDiscountType)}>
            {COUPON_DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {COUPON_DISCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>

        {isPct ? (
          <Field label="Percent off (1–100)" htmlFor="cf-pct">
            <Input id="cf-pct" type="number" min={1} max={100} value={form.percentOff} onChange={(e) => set('percentOff', e.target.value)} />
          </Field>
        ) : (
          <Field label="Amount off (BZD)" htmlFor="cf-amt">
            <Input id="cf-amt" type="number" min={0} step="0.01" value={form.amountOff} onChange={(e) => set('amountOff', e.target.value)} />
          </Field>
        )}

        <Field label="Min spend (BZD)" htmlFor="cf-min">
          <Input id="cf-min" type="number" min={0} step="0.01" value={form.minSpend} onChange={(e) => set('minSpend', e.target.value)} />
        </Field>
        <Field label="Max discount (BZD)" htmlFor="cf-maxd">
          <Input id="cf-maxd" type="number" min={0} step="0.01" value={form.maxDiscount} onChange={(e) => set('maxDiscount', e.target.value)} />
        </Field>
        <Field label="Max uses" htmlFor="cf-maxu">
          <Input id="cf-maxu" type="number" min={1} value={form.maxUses} onChange={(e) => set('maxUses', e.target.value)} />
        </Field>
        <Field label="Per-user limit" htmlFor="cf-peru">
          <Input id="cf-peru" type="number" min={1} value={form.perUserLimit} onChange={(e) => set('perUserLimit', e.target.value)} />
        </Field>
        <Field label="Starts" htmlFor="cf-start">
          <Input id="cf-start" type="date" value={form.startAt} onChange={(e) => set('startAt', e.target.value)} />
        </Field>
        <Field label="Ends" htmlFor="cf-end">
          <Input id="cf-end" type="date" value={form.endAt} onChange={(e) => set('endAt', e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-4">
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-belize-navy">
          <input type="checkbox" checked={form.freeShipping} onChange={(e) => set('freeShipping', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue" />
          Free shipping
        </label>
        <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-belize-navy">
          <input type="checkbox" checked={form.stackable} onChange={(e) => set('stackable', e.target.checked)} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue" />
          Stackable
        </label>
      </div>

      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={busy} onClick={() => void submit()}>
          {busy ? (
            <>
              <Spinner className="h-4 w-4" /> Saving…
            </>
          ) : mode === 'create' ? (
            'Create coupon'
          ) : (
            'Save changes'
          )}
        </Button>
        <Button size="sm" variant="outline" disabled={busy} onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Homepage curation                                                   */
/* ------------------------------------------------------------------ */

function HomepageTab() {
  const [data, setData] = useState<HomepageCuration | null>(null);
  const [draft, setDraft] = useState<Record<string, { priority: number; isActive: boolean }>>({});
  const [state, setState] = useState<ListState>('loading');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    setError(null);
    try {
      const d = await api.get<HomepageCuration>('/admin/marketing/homepage');
      setData(d);
      const next: Record<string, { priority: number; isActive: boolean }> = {};
      for (const items of Object.values(d.placements)) {
        for (const it of items) next[it.promotionId] = { priority: it.priority, isActive: it.isActive };
      }
      setDraft(next);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function save() {
    if (!data) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const seen = new Set<string>();
      const items: Array<{ promotionId: string; priority: number; isActive: boolean }> = [];
      for (const list of Object.values(data.placements)) {
        for (const it of list) {
          if (seen.has(it.promotionId)) continue;
          seen.add(it.promotionId);
          const d = draft[it.promotionId] ?? { priority: it.priority, isActive: it.isActive };
          items.push({ promotionId: it.promotionId, priority: d.priority, isActive: d.isActive });
        }
      }
      const updated = await api.put<HomepageCuration>('/admin/marketing/homepage', { items });
      setData(updated);
      const next: Record<string, { priority: number; isActive: boolean }> = {};
      for (const list of Object.values(updated.placements)) {
        for (const it of list) next[it.promotionId] = { priority: it.priority, isActive: it.isActive };
      }
      setDraft(next);
      setNotice('Homepage curation saved.');
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the homepage.manage permission." : apiMessage(err, 'Could not save homepage curation.'));
    } finally {
      setBusy(false);
    }
  }

  if (state === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>homepage.manage</code> permission required to curate the homepage.
      </Alert>
    );
  }
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading homepage curation…
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <Alert tone="error">
        Could not load homepage curation.{' '}
        <button type="button" onClick={() => void load()} className="font-semibold underline">
          Retry
        </button>
      </Alert>
    );
  }

  const total = HOMEPAGE_PLACEMENTS.reduce((acc, p) => acc + (data.placements[p]?.length ?? 0), 0);

  return (
    <div className="space-y-5">
      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}
      {error && <Alert tone="error">{error}</Alert>}

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <p className="text-sm text-slate-500">
          Adjust priority ordering and feature/hide toggles for promotions placed in homepage slots. A promotion can only serve
          (be active) once it is <strong>Approved</strong>.
        </p>
        <Button size="sm" disabled={busy || total === 0} onClick={() => void save()}>
          {busy ? (
            <>
              <Spinner className="h-4 w-4" /> Saving…
            </>
          ) : (
            'Save curation'
          )}
        </Button>
      </div>

      {total === 0 ? (
        <EmptyState title="No homepage promotions" description="No promotions are currently placed in homepage slots." />
      ) : (
        <div className="space-y-5">
          {HOMEPAGE_PLACEMENTS.map((placement) => {
            const items = data.placements[placement] ?? [];
            return (
              <div key={placement} className="rounded-bmpl-xl border border-slate-200 bg-white">
                <div className="border-b border-slate-200 p-4">
                  <h3 className="text-sm font-semibold text-belize-navy">{placementLabel(placement)}</h3>
                  <p className="text-xs text-slate-400">{num(items.length)} promotions</p>
                </div>
                {items.length === 0 ? (
                  <p className="p-4 text-sm text-slate-400">Nothing placed here.</p>
                ) : (
                  <ul className="divide-y divide-slate-100">
                    {items
                      .slice()
                      .sort((a, b) => (draft[b.promotionId]?.priority ?? b.priority) - (draft[a.promotionId]?.priority ?? a.priority))
                      .map((it) => {
                        const d = draft[it.promotionId] ?? { priority: it.priority, isActive: it.isActive };
                        const canServe = it.status === 'APPROVED';
                        return (
                          <li key={`${placement}-${it.promotionId}`} className="flex flex-wrap items-center gap-3 p-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate text-sm font-semibold text-belize-navy">{it.title}</span>
                                <StatusBadge status={it.status} />
                                {d.isActive && <Badge tone="success">Live</Badge>}
                              </div>
                              <p className="text-xs text-slate-400">{promotionTypeLabel(it.type)}</p>
                            </div>
                            <div className="w-28">
                              <Field label="Priority" htmlFor={`hp-${it.promotionId}`}>
                                <Input
                                  id={`hp-${it.promotionId}`}
                                  type="number"
                                  min={0}
                                  max={1000}
                                  value={String(d.priority)}
                                  onChange={(e) =>
                                    setDraft((prev) => ({
                                      ...prev,
                                      [it.promotionId]: { priority: Math.trunc(Number(e.target.value) || 0), isActive: d.isActive },
                                    }))
                                  }
                                />
                              </Field>
                            </div>
                            <label className="flex cursor-pointer items-center gap-2 pt-5 text-sm font-medium text-belize-navy">
                              <input
                                type="checkbox"
                                checked={d.isActive}
                                disabled={!canServe}
                                onChange={(e) =>
                                  setDraft((prev) => ({
                                    ...prev,
                                    [it.promotionId]: { priority: d.priority, isActive: e.target.checked },
                                  }))
                                }
                                className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue disabled:opacity-50"
                              />
                              Featured
                              {!canServe && <span className="text-xs text-slate-400">(approve first)</span>}
                            </label>
                          </li>
                        );
                      })}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reports                                                             */
/* ------------------------------------------------------------------ */

const REPORT_STATUS_OPTIONS: Array<{ value: PromotionReportStatus; label: string }> = PROMOTION_REPORT_STATUSES.map((s) => ({
  value: s,
  label: s.charAt(0) + s.slice(1).toLowerCase(),
}));

function ReportsTab() {
  const [status, setStatus] = useState<PromotionReportStatus>('OPEN');
  const [items, setItems] = useState<PromotionReportItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const rows = await api.get<PromotionReportItem[]>(`/admin/marketing/reports?status=${status}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onResolved = useCallback((reportId: string, resolvedStatus: 'ACTIONED' | 'DISMISSED') => {
    setItems((prev) => prev.filter((r) => r.id !== reportId));
    setNotice(`Report ${resolvedStatus === 'ACTIONED' ? 'actioned' : 'dismissed'}.`);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Report status" htmlFor="report-status">
            <Select id="report-status" value={status} onChange={(e) => setStatus(e.target.value as PromotionReportStatus)}>
              {REPORT_STATUS_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
      </div>

      {notice && (
        <Alert tone="success">
          <div className="flex items-center justify-between gap-3">
            <span>{notice}</span>
            <button type="button" onClick={() => setNotice(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {listState === 'forbidden' ? (
        <Alert tone="warning" title="You don't have permission">
          You do not have the <code>promotions.read</code> permission required to view reports.
        </Alert>
      ) : listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading reports…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load reports.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No reports" description={`No ${status.toLowerCase()} reports to show.`} />
      ) : (
        <ul className="space-y-4">
          {items.map((rep) => (
            <ReportCard key={rep.id} report={rep} resolvable={status === 'OPEN'} onResolved={onResolved} />
          ))}
        </ul>
      )}
    </div>
  );
}

function ReportCard({
  report,
  resolvable,
  onResolved,
}: {
  report: PromotionReportItem;
  resolvable: boolean;
  onResolved: (id: string, status: 'ACTIONED' | 'DISMISSED') => void;
}) {
  const [pending, setPending] = useState<'ACTIONED' | 'DISMISSED' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(resolveStatus: 'ACTIONED' | 'DISMISSED') {
    setBusy(true);
    setError(null);
    try {
      const trimmed = note.trim();
      await api.post<{ ok: true }>(`/admin/marketing/reports/${report.id}/resolve`, {
        status: resolveStatus,
        ...(trimmed ? { note: trimmed } : {}),
      });
      onResolved(report.id, resolveStatus);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the promotions.moderate permission." : apiMessage(err, 'Action failed. Please try again.'));
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="error">{PROMOTION_REPORT_REASON_LABELS[report.reason] ?? report.reason}</Badge>
          <StatusBadge status={report.status} />
        </div>
        <span className="shrink-0 text-xs text-slate-400">{relativeTime(report.createdAt)}</span>
      </div>

      {report.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{report.note}</p>}

      <div className="mt-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-belize-navy">{report.promotion.title}</span>
          <StatusBadge status={report.promotion.status} />
        </div>
        <p className="text-xs text-slate-400">{promotionTypeLabel(report.promotion.type)}</p>
      </div>

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {resolvable && (
        <div className="mt-4 border-t border-slate-100 pt-3">
          {pending ? (
            <div className="space-y-2">
              <Field label="Optional note" htmlFor={`note-${report.id}`} hint="Optional free text, up to 1000 characters.">
                <Textarea
                  id={`note-${report.id}`}
                  rows={2}
                  maxLength={1000}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for this resolution (optional)…"
                />
              </Field>
              <div className="flex flex-wrap items-center gap-2">
                <Button size="sm" variant={pending === 'ACTIONED' ? 'primary' : 'outline'} disabled={busy} onClick={() => void submit(pending)}>
                  {busy ? (
                    <>
                      <Spinner className="h-4 w-4" /> Working…
                    </>
                  ) : pending === 'ACTIONED' ? (
                    'Confirm action'
                  ) : (
                    'Confirm dismiss'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={busy}
                  onClick={() => {
                    setPending(null);
                    setNote('');
                    setError(null);
                  }}
                >
                  Cancel
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setPending('ACTIONED')}>
                Action
              </Button>
              <Button size="sm" variant="outline" onClick={() => setPending('DISMISSED')}>
                Dismiss
              </Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

function pct(ratio: number): string {
  return `${(ratio * 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 1 })}%`;
}

function AnalyticsTab() {
  const [data, setData] = useState<MarketingAnalytics | null>(null);
  const [state, setState] = useState<ListState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<MarketingAnalytics>('/admin/marketing/analytics');
      setData(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (state === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>marketing.analytics</code> permission required to view analytics.
      </Alert>
    );
  }
  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading analytics…
      </div>
    );
  }
  if (state === 'error' || !data) {
    return (
      <Alert tone="error">
        Could not load analytics.{' '}
        <button type="button" onClick={() => void load()} className="font-semibold underline">
          Retry
        </button>
      </Alert>
    );
  }

  const kpis: Array<{ label: string; value: string; hint?: string }> = [
    { label: 'Serving now', value: num(data.servingNow), hint: 'Approved + active' },
    { label: 'Pending moderation', value: num(data.pendingModeration), hint: 'Submitted + under review' },
    { label: 'Open reports', value: num(data.openReports) },
    { label: 'Active campaigns', value: num(data.activeCampaigns), hint: 'Running' },
    { label: 'Active coupons', value: num(data.activeCoupons) },
    { label: 'Impressions', value: num(data.totals.impressions) },
    { label: 'Views', value: num(data.totals.views) },
    { label: 'Clicks', value: num(data.totals.clicks) },
    { label: 'Conversions', value: num(data.totals.conversions) },
    { label: 'CTR', value: pct(data.totals.ctr) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold text-belize-navy">{k.value}</p>
            {k.hint && <p className="mt-0.5 text-xs text-slate-400">{k.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MiniTable title="Promotions by status" rows={data.byStatus.map((s) => ({ label: promotionStatusLabel(s.status), count: s.count }))} />
        <MiniTable title="Promotions by type" rows={data.byType.map((t) => ({ label: promotionTypeLabel(t.type), count: t.count }))} />
      </div>

      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <p className="mb-3 text-sm font-semibold text-belize-navy">Top promotions (by views)</p>
        {data.topPromotions.length === 0 ? (
          <p className="text-sm text-slate-400">No promotion metrics yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs font-semibold uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3">Promotion</th>
                  <th className="py-2 pr-3">Status</th>
                  <th className="py-2 pr-3 text-right">Views</th>
                  <th className="py-2 pr-3 text-right">Clicks</th>
                  <th className="py-2 pr-3 text-right">Impressions</th>
                  <th className="py-2 text-right">CTR</th>
                </tr>
              </thead>
              <tbody>
                {data.topPromotions.map((p) => (
                  <tr key={p.id} className="border-b border-slate-100">
                    <td className="py-2 pr-3">
                      <span className="font-medium text-belize-navy">{p.title}</span>
                      <span className="ml-2 text-xs text-slate-400">{promotionTypeLabel(p.type)}</span>
                    </td>
                    <td className="py-2 pr-3">
                      <StatusBadge status={p.status} />
                    </td>
                    <td className="py-2 pr-3 text-right">{num(p.views)}</td>
                    <td className="py-2 pr-3 text-right">{num(p.clicks)}</td>
                    <td className="py-2 pr-3 text-right">{num(p.impressions)}</td>
                    <td className="py-2 text-right">{pct(p.ctr)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniTable({ title, rows }: { title: string; rows: Array<{ label: string; count: number }> }) {
  const max = rows.reduce((m, r) => Math.max(m, r.count), 0);
  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <p className="mb-3 text-sm font-semibold text-belize-navy">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">No data yet.</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center gap-3">
              <span className="w-40 shrink-0 truncate text-sm text-belize-navy" title={r.label}>
                {r.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div className="h-full rounded-full bg-belize-blue" style={{ width: max > 0 ? `${Math.max(4, (r.count / max) * 100)}%` : '0%' }} aria-hidden />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-semibold text-belize-navy">{num(r.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
