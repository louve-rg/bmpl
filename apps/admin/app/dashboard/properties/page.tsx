'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  DISTRICT_LABELS,
  PROPERTY_STATUSES,
  PROPERTY_STATUS_LABELS,
  PROPERTY_TYPE_LABELS,
  LISTING_PURPOSE_LABELS,
  FURNISHING_LABELS,
  RENTAL_PERIOD_LABELS,
  AREA_UNIT_LABELS,
  AGENT_SPECIALTY_LABELS,
  type District,
  type PropertyStatus,
  type PropertyType,
  type ListingPurpose,
  type Furnishing,
  type RentalPeriod,
  type AreaUnit,
  type AgentSpecialty,
  type PropertyReportReason,
  type PropertyReportStatus,
  type PropertyDocumentKind,
} from '@bmpl/shared';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Spinner, Textarea } from '../../../components/ui';

/**
 * Belize Homes (Real Estate) admin console — M25. Client shapes mirror the
 * documented GET /admin/properties* responses. Money is in MINOR units (BZD
 * cents); labels are imported from @bmpl/shared so admin/web/api never drift.
 * Private ownership documents are gated behind property_documents.read and
 * degrade to a restricted state on 403.
 */

type ListState = 'loading' | 'ready' | 'error' | 'forbidden';

interface PropertyLocation {
  visibility: string;
  district: string | null;
  locality?: string | null;
  generalAddress?: string | null;
  latitude?: number | null;
  longitude?: number | null;
}

interface PropertyListItem {
  id: string;
  title: string;
  slug: string;
  reference: string;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  priceMinor: number;
  currency: string;
  rentalPeriod: RentalPeriod | null;
  negotiable: boolean;
  bedrooms: number | null;
  bathrooms: number | null;
  propertySize: number | null;
  landSize: number | null;
  areaUnit: AreaUnit | null;
  furnishing: Furnishing | null;
  status: PropertyStatus;
  location: PropertyLocation;
  primaryImageUrl: string | null;
  publishedAt: string | null;
  createdAt: string;
  moderationReason: string | null;
  owner: string;
  agent: { displayName: string; slug: string } | null;
  reportCount: number;
  enquiryCount: number;
}

interface PropertyDocumentMeta {
  id: string;
  kind: PropertyDocumentKind;
  label: string | null;
  mimeType: string;
  fileSizeBytes: number;
  scanStatus: string;
  createdAt: string;
}

interface PropertyDetail {
  id: string;
  title: string;
  slug: string;
  reference: string;
  status: PropertyStatus;
  purpose: ListingPurpose;
  propertyType: PropertyType;
  description: string;
  priceMinor: number;
  currency: string;
  rentalPeriod: RentalPeriod | null;
  negotiable: boolean;
  district: string | null;
  locality: string | null;
  generalAddress: string | null;
  exactAddress: string | null;
  latitude: number | null;
  longitude: number | null;
  locationVisibility: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  halfBathrooms: number | null;
  parkingSpaces: number | null;
  propertySize: number | null;
  landSize: number | null;
  areaUnit: string | null;
  yearBuilt: number | null;
  furnishing: Furnishing | null;
  tenure: string | null;
  petPolicy: string | null;
  availabilityDate: string | null;
  leaseTerm: string | null;
  condition: string | null;
  videoUrl: string | null;
  authorityVerified: boolean;
  moderationReason: string | null;
  viewCount: number;
  publishedAt: string | null;
  soldAt: string | null;
  rentedAt: string | null;
  createdAt: string;
  updatedAt: string;
  amenities: string[];
  utilities: string[];
  images: Array<{
    id: string;
    url: string | null;
    altText: string | null;
    caption: string | null;
    areaLabel: string | null;
    position: number;
    isPrimary: boolean;
  }>;
  documents: PropertyDocumentMeta[];
  statusHistory: Array<{ from: string | null; to: string; note: string | null; at: string }>;
  priceHistory: Array<{ priceMinor: number; currency: string; at: string }>;
  assignments: Array<{
    id: string;
    status: string;
    agent: { id: string; displayName: string; slug: string } | null;
    assignedAt: string;
    acceptedAt: string | null;
    endedAt: string | null;
  }>;
  owner: { id: string; name: string; phone: string | null; email: string | null };
  agent: { id: string; displayName: string; slug: string } | null;
  agency: { id: string; name: string; slug: string } | null;
}

/** Downloadable document (from the property_documents.read endpoint). */
interface PropertyDocument extends PropertyDocumentMeta {
  url: string | null;
}

interface PropertyReportItem {
  id: string;
  listingId: string;
  reason: PropertyReportReason;
  note: string | null;
  status: PropertyReportStatus;
  createdAt: string;
  listing: { id: string; title: string; slug: string; reference: string; status: PropertyStatus };
}

interface OwnerListItem {
  id: string;
  name: string;
  district: string | null;
  approvalStatus: string;
  identityVerified: boolean;
  listingCount: number;
  createdAt: string;
}

interface OwnerDetail {
  id: string;
  legalName: string;
  displayName: string | null;
  phone: string | null;
  email: string | null;
  district: string | null;
  approvalStatus: string;
  identityVerified: boolean;
  listingCount: number;
  listingsByStatus: Array<{ status: string; count: number }>;
  createdAt?: string;
}

interface AgentListItem {
  id: string;
  displayName: string;
  slug: string;
  agency: { name: string; slug: string } | null;
  approvalStatus: string;
  isActive: boolean;
  listingCount: number;
  createdAt: string;
}

interface AgentDetail {
  id: string;
  displayName: string;
  slug: string;
  bio: string | null;
  licenseNumber: string | null;
  specialties: AgentSpecialty[];
  district: string | null;
  phone: string | null;
  email: string | null;
  agency: { name: string; slug: string } | null;
  approvalStatus: string;
  isActive: boolean;
  listingCount: number;
  listingsByStatus: Array<{ status: string; count: number }>;
  createdAt?: string;
}

interface PropertyAnalytics {
  activeListings: number;
  approvalBacklog: number;
  reported: number;
  forSale: number;
  forRent: number;
  enquiries: number;
  viewingRequests: number;
  activeOwners: number;
  activeAgents: number;
  byType: Array<{ propertyType: string; count: number }>;
  byDistrict: Array<{ district: string; count: number }>;
}

type ModerateAction = 'APPROVE' | 'REJECT' | 'REQUEST_INFO' | 'UNPUBLISH' | 'SUSPEND' | 'RESTORE' | 'ARCHIVE';
type Tab = 'moderation' | 'listings' | 'reports' | 'owners' | 'agents' | 'analytics';

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function num(n: number): string {
  return Math.round(n).toLocaleString();
}

/** Minor units (cents) → BZD dollars string. */
function moneyMinor(minor: number): string {
  return `BZD ${(minor / 100).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function formatPrice(item: { priceMinor: number | null; purpose: ListingPurpose; rentalPeriod: RentalPeriod | null }): string | null {
  if (item.priceMinor == null) return null;
  const base = moneyMinor(item.priceMinor);
  if (item.purpose === 'FOR_RENT' && item.rentalPeriod) return `${base} ${RENTAL_PERIOD_LABELS[item.rentalPeriod]}`;
  return base;
}

function propertyStatusLabel(s: string): string {
  return PROPERTY_STATUS_LABELS[s as PropertyStatus] ?? s.replace(/_/g, ' ');
}

function propertyTypeLabel(s: string): string {
  return PROPERTY_TYPE_LABELS[s as PropertyType] ?? s.replace(/_/g, ' ');
}

function purposeLabel(s: string): string {
  return LISTING_PURPOSE_LABELS[s as ListingPurpose] ?? s.replace(/_/g, ' ');
}

function areaLabel(value: number | null, unit: AreaUnit | null): string | null {
  if (value == null) return null;
  return `${num(value)}${unit ? ` ${AREA_UNIT_LABELS[unit]}` : ''}`;
}

function districtLabel(s: string | null): string | null {
  if (!s) return null;
  return DISTRICT_LABELS[s as District] ?? s.replace(/_/g, ' ');
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'moderation', label: 'Moderation queue' },
  { key: 'listings', label: 'All listings' },
  { key: 'reports', label: 'Reports' },
  { key: 'owners', label: 'Owners' },
  { key: 'agents', label: 'Agents' },
  { key: 'analytics', label: 'Analytics' },
];

export default function PropertiesPage() {
  const [tab, setTab] = useState<Tab>('moderation');

  return (
    <div>
      <PageHeader
        eyebrow="Belize Homes"
        title="Real estate moderation & operations"
        description="Moderate property listings, resolve community reports, manage owners and agents, and track Belize Homes performance."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Belize Homes views">
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

      {tab === 'moderation' && <ListingsTab key="moderation" queue />}
      {tab === 'listings' && <ListingsTab key="listings" queue={false} />}
      {tab === 'reports' && <ReportsTab />}
      {tab === 'owners' && <OwnersTab />}
      {tab === 'agents' && <AgentsTab />}
      {tab === 'analytics' && <AnalyticsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Listings (moderation queue + all listings)                          */
/* ------------------------------------------------------------------ */

const QUEUE_STATUSES: readonly PropertyStatus[] = ['SUBMITTED', 'UNDER_REVIEW', 'MORE_INFO_REQUIRED'];

const QUEUE_STATUS_OPTIONS: Array<{ value: PropertyStatus | ''; label: string }> = [
  { value: '', label: 'All pending' },
  ...QUEUE_STATUSES.map((s) => ({ value: s, label: PROPERTY_STATUS_LABELS[s] })),
];

const ALL_STATUS_OPTIONS: Array<{ value: PropertyStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  ...PROPERTY_STATUSES.map((s) => ({ value: s, label: PROPERTY_STATUS_LABELS[s] })),
];

function ListingsTab({ queue }: { queue: boolean }) {
  const [status, setStatus] = useState<PropertyStatus | ''>('');
  const [reportedOnly, setReportedOnly] = useState(false);
  const [items, setItems] = useState<PropertyListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const options = queue ? QUEUE_STATUS_OPTIONS : ALL_STATUS_OPTIONS;

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (reportedOnly) params.set('reported', 'true');
      const qs = params.toString();
      let rows = await api.get<PropertyListItem[]>(`/admin/properties${qs ? `?${qs}` : ''}`);
      // In moderation mode with no specific status, restrict to the pending queue.
      if (queue && !status) rows = rows.filter((r) => QUEUE_STATUSES.includes(r.status));
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status, reportedOnly, queue]);

  useEffect(() => {
    void load();
  }, [load]);

  const onModerated = useCallback(
    (updated: PropertyDetail) => {
      setItems((prev) => {
        const mapped = prev.map((p) =>
          p.id === updated.id ? { ...p, status: updated.status, moderationReason: updated.moderationReason } : p,
        );
        // Drop items that no longer belong in the pending queue view.
        return queue && !status ? mapped.filter((p) => QUEUE_STATUSES.includes(p.status)) : mapped;
      });
      setNotice(`"${updated.title}" set to ${propertyStatusLabel(updated.status)}.`);
    },
    [queue, status],
  );

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>properties.read</code> permission required to view listings.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="property-status">
            <Select id="property-status" value={status} onChange={(e) => setStatus(e.target.value as PropertyStatus | '')}>
              {options.map((o) => (
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
              <Spinner className="h-4 w-4" /> Loading listings…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load listings.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No listings" description={queue ? 'No listings are awaiting moderation.' : 'No listings match the current filters.'} />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((p) => {
                const active = p.id === selectedId;
                const price = formatPrice(p);
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
                        <span>{propertyTypeLabel(p.propertyType)}</span>
                        <span aria-hidden>·</span>
                        <span>{purposeLabel(p.purpose)}</span>
                        {districtLabel(p.location.district) && (
                          <>
                            <span aria-hidden>·</span>
                            <span>{districtLabel(p.location.district)}</span>
                          </>
                        )}
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        {price && <span className="font-medium text-belize-navy">{price}</span>}
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
          <PropertyDetailPanel key={selectedId} id={selectedId} onModerated={onModerated} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No listing selected" description="Choose a listing from the list to review its full content." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

const REASON_REQUIRED: Record<ModerateAction, boolean> = {
  APPROVE: false,
  REJECT: true,
  REQUEST_INFO: true,
  UNPUBLISH: false,
  SUSPEND: false,
  RESTORE: false,
  ARCHIVE: false,
};

const ACTION_LABELS: Record<ModerateAction, string> = {
  APPROVE: 'Approve & publish',
  REJECT: 'Reject',
  REQUEST_INFO: 'Request info',
  UNPUBLISH: 'Unpublish',
  SUSPEND: 'Suspend',
  RESTORE: 'Restore',
  ARCHIVE: 'Archive',
};

function availableActions(status: PropertyStatus): ModerateAction[] {
  const reviewable = status === 'SUBMITTED' || status === 'UNDER_REVIEW' || status === 'MORE_INFO_REQUIRED';
  const actions: ModerateAction[] = [];
  if (reviewable) actions.push('APPROVE', 'REQUEST_INFO', 'REJECT');
  if (status === 'PUBLISHED' || status === 'UNDER_OFFER') actions.push('UNPUBLISH');
  if (status === 'SUSPENDED') actions.push('RESTORE');
  else if (status !== 'ARCHIVED') actions.push('SUSPEND');
  if (status !== 'ARCHIVED') actions.push('ARCHIVE');
  return actions;
}

function PropertyDetailPanel({ id, onModerated }: { id: string; onModerated: (p: PropertyDetail) => void }) {
  const [detail, setDetail] = useState<PropertyDetail | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [pending, setPending] = useState<ModerateAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<PropertyDetail>(`/admin/properties/${id}`);
      setDetail(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: ModerateAction) {
    const trimmed = reason.trim();
    if (REASON_REQUIRED[action] && !trimmed) {
      setError('A reason is required for this action.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.post<PropertyDetail>(`/admin/properties/${id}/moderate`, {
        action,
        ...(trimmed ? { reason: trimmed } : {}),
      });
      setDetail(updated);
      setPending(null);
      setReason('');
      onModerated(updated);
    } catch (err) {
      const s = apiStatus(err);
      setError(
        s === 403
          ? "You don't have the properties.moderate permission."
          : (typeof err === 'object' && err !== null && (err as ApiError).message) || 'Action failed. Please try again.',
      );
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading listing…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="You don't have permission">
          You do not have the <code>properties.read</code> permission required to view this listing.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this listing.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  const price = formatPrice(detail);
  const areaUnit = (detail.areaUnit as AreaUnit | null) ?? null;
  const area = areaLabel(detail.propertySize, areaUnit);
  const land = areaLabel(detail.landSize, areaUnit);
  const actions = availableActions(detail.status);

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-belize-navy">{detail.title}</h2>
          <StatusBadge status={detail.status} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <Badge tone="brand">{purposeLabel(detail.purpose)}</Badge>
          <Badge tone="neutral">{propertyTypeLabel(detail.propertyType)}</Badge>
          {districtLabel(detail.district) && <Badge tone="neutral">{districtLabel(detail.district)}</Badge>}
          {detail.furnishing && <Badge tone="info">{FURNISHING_LABELS[detail.furnishing]}</Badge>}
          {detail.negotiable && <Badge tone="neutral">Negotiable</Badge>}
          {detail.authorityVerified && <Badge tone="success">Authority verified</Badge>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {price && <span className="font-medium text-belize-navy">{price}</span>}
          {detail.bedrooms != null && <span>{num(detail.bedrooms)} bed</span>}
          {detail.bathrooms != null && <span>{num(detail.bathrooms)} bath</span>}
          {detail.parkingSpaces != null && <span>{num(detail.parkingSpaces)} parking</span>}
          {area && <span>{area}</span>}
          {land && <span>Land {land}</span>}
          {detail.yearBuilt != null && <span>Built {detail.yearBuilt}</span>}
          {detail.tenure && <span>{detail.tenure.replace(/_/g, ' ').toLowerCase()}</span>}
          {detail.condition && <span>{detail.condition.replace(/_/g, ' ').toLowerCase()}</span>}
          <span>Created {relativeTime(detail.createdAt)}</span>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {detail.locality && <span>{detail.locality}</span>}
          {detail.generalAddress && <span>{detail.generalAddress}</span>}
          {detail.exactAddress && <span className="text-belize-navy">{detail.exactAddress}</span>}
          {detail.locationVisibility && <span>Visibility: {detail.locationVisibility.replace(/_/g, ' ').toLowerCase()}</span>}
          <span>{num(detail.viewCount)} {detail.viewCount === 1 ? 'view' : 'views'}</span>
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
        <ExpandableText label="Description" text={detail.description} />

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Listed by</p>
          <div className="flex flex-wrap gap-1.5">
            <Badge tone="neutral">
              Owner: {detail.owner.name}
              {detail.owner.email ? ` · ${detail.owner.email}` : ''}
              {detail.owner.phone ? ` · ${detail.owner.phone}` : ''}
            </Badge>
            {detail.agent && <Badge tone="brand">Agent: {detail.agent.displayName}</Badge>}
            {detail.agency && <Badge tone="info">Agency: {detail.agency.name}</Badge>}
          </div>
        </div>

        {detail.utilities.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Utilities</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.utilities.map((u) => (
                <Badge key={u} tone="neutral">
                  {u}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.amenities.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">Amenities</p>
            <div className="flex flex-wrap gap-1.5">
              {detail.amenities.map((a) => (
                <Badge key={a} tone="success">
                  {a}
                </Badge>
              ))}
            </div>
          </div>
        )}

        {detail.images.length > 0 && (
          <div>
            <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Images ({num(detail.images.length)})
            </p>
            <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
              {detail.images.map((img) =>
                img.url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    key={img.id}
                    src={img.url}
                    alt={img.altText ?? img.areaLabel ?? img.caption ?? 'Property image'}
                    className="aspect-square w-full rounded-bmpl-md border border-slate-200 object-cover"
                  />
                ) : null,
              )}
            </div>
          </div>
        )}

        <DocumentsSection propertyId={detail.id} />
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
              hint="Shared with the owner/agent in the moderation notice. Up to 1000 characters."
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
                variant={pending === 'REJECT' || pending === 'SUSPEND' ? 'destructive' : 'primary'}
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
                variant={a === 'APPROVE' || a === 'RESTORE' ? 'primary' : a === 'REJECT' || a === 'SUSPEND' ? 'destructive' : 'outline'}
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

/**
 * Private ownership documents — HIGHLY RESTRICTED (property_documents.read,
 * super-admin only). Fetched only on explicit request; a 403 renders a
 * "restricted" state rather than an error so non-privileged admins are not
 * blocked from the rest of the listing.
 */
function DocumentsSection({ propertyId }: { propertyId: string }) {
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'error' | 'restricted'>('idle');
  const [docs, setDocs] = useState<PropertyDocument[]>([]);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const rows = await api.get<PropertyDocument[]>(`/admin/properties/${propertyId}/documents`);
      setDocs(rows);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'restricted' : 'error');
    }
  }, [propertyId]);

  return (
    <div className="rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">Ownership documents</p>
        {state === 'idle' && (
          <Button size="sm" variant="outline" onClick={() => void load()}>
            View documents
          </Button>
        )}
      </div>

      {state === 'idle' && (
        <p className="mt-2 text-xs text-slate-400">
          Private ownership documents are restricted to super-admins with <code>property_documents.read</code>.
        </p>
      )}
      {state === 'loading' && (
        <div className="mt-2 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading documents…
        </div>
      )}
      {state === 'restricted' && (
        <div className="mt-2">
          <Alert tone="warning" title="Restricted">
            You do not have the <code>property_documents.read</code> permission required to view private ownership documents.
          </Alert>
        </div>
      )}
      {state === 'error' && (
        <div className="mt-2">
          <Alert tone="error">
            Could not load documents.{' '}
            <button type="button" onClick={() => void load()} className="font-semibold underline">
              Retry
            </button>
          </Alert>
        </div>
      )}
      {state === 'ready' &&
        (docs.length === 0 ? (
          <p className="mt-2 text-sm text-slate-400">No documents on file for this listing.</p>
        ) : (
          <ul className="mt-2 space-y-1.5">
            {docs.map((d) => (
              <li
                key={d.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-bmpl-md border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <Badge tone="neutral">{d.kind.replace(/_/g, ' ').toLowerCase()}</Badge>
                  <span className="truncate text-belize-navy">{d.label ?? 'Document'}</span>
                  <span className="text-xs text-slate-400">{formatBytes(d.fileSizeBytes)}</span>
                  <Badge tone={d.scanStatus === 'CLEAN' ? 'success' : d.scanStatus === 'INFECTED' ? 'error' : 'warning'}>
                    {d.scanStatus.replace(/_/g, ' ').toLowerCase()}
                  </Badge>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-xs text-slate-400">{relativeTime(d.createdAt)}</span>
                  {d.url && (
                    <a href={d.url} target="_blank" rel="noopener noreferrer" className="text-belize-blue underline">
                      Open
                    </a>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ))}
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
/* Reports queue                                                       */
/* ------------------------------------------------------------------ */

const REPORT_STATUS_OPTIONS: Array<{ value: PropertyReportStatus; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACTIONED', label: 'Actioned' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

function ReportsTab() {
  const [status, setStatus] = useState<PropertyReportStatus>('OPEN');
  const [items, setItems] = useState<PropertyReportItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const rows = await api.get<PropertyReportItem[]>(`/admin/properties/reports?status=${status}`);
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
            <Select id="report-status" value={status} onChange={(e) => setStatus(e.target.value as PropertyReportStatus)}>
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
          You do not have the <code>property_reports.read</code> permission required to view reports.
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
  report: PropertyReportItem;
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
      await api.post<{ ok: true }>(`/admin/properties/reports/${report.id}/resolve`, {
        status: resolveStatus,
        ...(trimmed ? { note: trimmed } : {}),
      });
      onResolved(report.id, resolveStatus);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have the properties.moderate permission." : 'Action failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="error">{report.reason.replace(/_/g, ' ')}</Badge>
          <StatusBadge status={report.status} />
        </div>
        <span className="shrink-0 text-xs text-slate-400">{relativeTime(report.createdAt)}</span>
      </div>

      {report.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{report.note}</p>}

      <div className="mt-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-belize-navy">{report.listing.title}</span>
          <StatusBadge status={report.listing.status} />
        </div>
        <p className="text-xs text-slate-400">Ref {report.listing.reference}</p>
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
                <Button
                  size="sm"
                  variant={pending === 'ACTIONED' ? 'primary' : 'outline'}
                  disabled={busy}
                  onClick={() => void submit(pending)}
                >
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
/* Owners                                                              */
/* ------------------------------------------------------------------ */

const PRINCIPAL_STATUS_OPTIONS: Array<{ value: string; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'APPROVED', label: 'Approved' },
  { value: 'PENDING', label: 'Pending' },
  { value: 'SUSPENDED', label: 'Suspended' },
];

function OwnersTab() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<OwnerListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const qs = status ? `?status=${status}` : '';
      const rows = await api.get<OwnerListItem[]>(`/admin/properties/owners${qs}`);
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = useCallback((updated: OwnerDetail) => {
    setItems((prev) => prev.map((o) => (o.id === updated.id ? { ...o, approvalStatus: updated.approvalStatus } : o)));
    setNotice(`${updated.displayName ?? updated.legalName} is now ${propertyStatusLabel(updated.approvalStatus)}.`);
  }, []);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>property_owners.read</code> permission required to view owners.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="owner-status">
            <Select id="owner-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {PRINCIPAL_STATUS_OPTIONS.map((o) => (
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="rounded-bmpl-xl border border-slate-200 bg-white">
          {listState === 'loading' ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading owners…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load owners.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No owners" description="No owners match the current filter." />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((o) => {
                const active = o.id === selectedId;
                return (
                  <li key={o.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(o.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                        active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{o.name}</span>
                        <StatusBadge status={o.approvalStatus} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        {districtLabel(o.district) && <span>{districtLabel(o.district)}</span>}
                        {o.identityVerified && <Badge tone="success">ID verified</Badge>}
                        <span aria-hidden>·</span>
                        <span>
                          {num(o.listingCount)} {o.listingCount === 1 ? 'listing' : 'listings'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId ? (
          <PrincipalDetailPanel<OwnerDetail> key={selectedId} kind="owners" id={selectedId} onChanged={onChanged} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No owner selected" description="Choose an owner to view details." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Agents                                                             */
/* ------------------------------------------------------------------ */

function AgentsTab() {
  const [status, setStatus] = useState('');
  const [items, setItems] = useState<AgentListItem[]>([]);
  const [listState, setListState] = useState<ListState>('loading');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const qs = status ? `?status=${status}` : '';
      const rows = await api.get<AgentListItem[]>(`/admin/properties/agents${qs}`);
      setItems(rows);
      setListState('ready');
      setSelectedId((prev) => (prev && rows.some((r) => r.id === prev) ? prev : rows[0]?.id ?? null));
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onChanged = useCallback((updated: AgentDetail) => {
    setItems((prev) => prev.map((a) => (a.id === updated.id ? { ...a, approvalStatus: updated.approvalStatus } : a)));
    setNotice(`${updated.displayName} is now ${propertyStatusLabel(updated.approvalStatus)}.`);
  }, []);

  if (listState === 'forbidden') {
    return (
      <Alert tone="warning" title="You don't have permission">
        You do not have the <code>real_estate_agents.read</code> permission required to view agents.
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[12rem]">
          <Field label="Status" htmlFor="agent-status">
            <Select id="agent-status" value={status} onChange={(e) => setStatus(e.target.value)}>
              {PRINCIPAL_STATUS_OPTIONS.map((o) => (
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

      <div className="grid gap-5 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)]">
        <div className="rounded-bmpl-xl border border-slate-200 bg-white">
          {listState === 'loading' ? (
            <div className="flex items-center gap-2 p-4 text-sm text-slate-500">
              <Spinner className="h-4 w-4" /> Loading agents…
            </div>
          ) : listState === 'error' ? (
            <div className="p-4">
              <Alert tone="error">
                Could not load agents.{' '}
                <button type="button" onClick={() => void load()} className="font-semibold underline">
                  Retry
                </button>
              </Alert>
            </div>
          ) : items.length === 0 ? (
            <div className="p-6">
              <EmptyState title="No agents" description="No agents match the current filter." />
            </div>
          ) : (
            <ul className="max-h-[72vh] divide-y divide-slate-100 overflow-y-auto">
              {items.map((a) => {
                const active = a.id === selectedId;
                return (
                  <li key={a.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(a.id)}
                      aria-current={active ? 'true' : undefined}
                      className={`flex w-full flex-col gap-1.5 px-4 py-3.5 text-left transition ${
                        active ? 'bg-belize-blue/5' : 'hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-start gap-2">
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-belize-navy">{a.displayName}</span>
                        <StatusBadge status={a.approvalStatus} />
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5 text-xs text-slate-400">
                        {a.agency && <span className="truncate">{a.agency.name}</span>}
                        {!a.isActive && <Badge tone="neutral">Inactive</Badge>}
                        <span aria-hidden>·</span>
                        <span>
                          {num(a.listingCount)} {a.listingCount === 1 ? 'listing' : 'listings'}
                        </span>
                      </div>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selectedId ? (
          <PrincipalDetailPanel<AgentDetail> key={selectedId} kind="agents" id={selectedId} onChanged={onChanged} />
        ) : (
          listState === 'ready' && (
            <div className="rounded-bmpl-xl border border-slate-200 bg-white p-6">
              <EmptyState title="No agent selected" description="Choose an agent to view details." />
            </div>
          )
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Owner / Agent detail (shared)                                       */
/* ------------------------------------------------------------------ */

type PrincipalKind = 'owners' | 'agents';

const PRINCIPAL_PERM: Record<PrincipalKind, string> = {
  owners: 'property_owners.moderate',
  agents: 'real_estate_agents.moderate',
};

function PrincipalDetailPanel<T extends OwnerDetail | AgentDetail>({
  kind,
  id,
  onChanged,
}: {
  kind: PrincipalKind;
  id: string;
  onChanged: (p: T) => void;
}) {
  const [detail, setDetail] = useState<T | null>(null);
  const [state, setState] = useState<ListState>('loading');
  const [pending, setPending] = useState<'suspend' | 'restore' | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<T>(`/admin/properties/${kind}/${id}`);
      setDetail(d);
      setState('ready');
    } catch (err) {
      setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [kind, id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(action: 'suspend' | 'restore') {
    setBusy(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const updated =
        action === 'suspend'
          ? await api.post<T>(`/admin/properties/${kind}/${id}/suspend`, trimmed ? { reason: trimmed } : {})
          : await api.post<T>(`/admin/properties/${kind}/${id}/restore`);
      setDetail(updated);
      setPending(null);
      setReason('');
      onChanged(updated);
    } catch (err) {
      setError(apiStatus(err) === 403 ? `You don't have the ${PRINCIPAL_PERM[kind]} permission.` : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading {kind === 'owners' ? 'owner' : 'agent'}…
      </div>
    );
  }
  if (state === 'forbidden') {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="warning" title="You don't have permission">
          You do not have permission to view this {kind === 'owners' ? 'owner' : 'agent'}.
        </Alert>
      </div>
    );
  }
  if (state === 'error' || !detail) {
    return (
      <div className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <Alert tone="error">
          Could not load this {kind === 'owners' ? 'owner' : 'agent'}.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      </div>
    );
  }

  // Both members of the union share these fields; narrow the rest by `kind`.
  const owner = kind === 'owners' ? (detail as unknown as OwnerDetail) : null;
  const agent = kind === 'agents' ? (detail as unknown as AgentDetail) : null;
  const displayName = agent ? agent.displayName : owner ? owner.displayName ?? owner.legalName : '';
  const suspended = detail.approvalStatus === 'SUSPENDED';

  return (
    <div className="rounded-bmpl-xl border border-slate-200 bg-white">
      <div className="border-b border-slate-200 p-4">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold text-belize-navy">{displayName}</h2>
          <StatusBadge status={detail.approvalStatus} />
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-400">
          {agent?.agency && <span>{agent.agency.name}</span>}
          {detail.email && <span>{detail.email}</span>}
          {detail.phone && <span>{detail.phone}</span>}
          {agent?.licenseNumber && <span>Licence {agent.licenseNumber}</span>}
          {districtLabel(detail.district) && <span>{districtLabel(detail.district)}</span>}
          {detail.createdAt && <span>Joined {relativeTime(detail.createdAt)}</span>}
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          {owner?.identityVerified && <Badge tone="success">Identity verified</Badge>}
          {agent && !agent.isActive && <Badge tone="neutral">Inactive</Badge>}
          {agent?.specialties.map((s) => (
            <Badge key={s} tone="brand">
              {AGENT_SPECIALTY_LABELS[s] ?? s}
            </Badge>
          ))}
        </div>
      </div>

      <div className="space-y-4 p-4">
        {agent?.bio && <ExpandableText label="Bio" text={agent.bio} />}

        <div>
          <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-400">
            Listings by status ({num(detail.listingCount)} total)
          </p>
          {detail.listingsByStatus.length === 0 ? (
            <p className="text-sm text-slate-400">No listings yet.</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {detail.listingsByStatus.map((s) => (
                <span
                  key={s.status}
                  className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-xs text-belize-navy"
                >
                  {propertyStatusLabel(s.status)}
                  <span className="font-semibold">{num(s.count)}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      {error && (
        <div className="px-4">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      <div className="border-t border-slate-100 p-4">
        {pending ? (
          <div className="space-y-2">
            {pending === 'suspend' && (
              <Field label="Reason (optional)" htmlFor={`principal-reason-${id}`} hint="Shared with the account holder in the notice.">
                <Textarea
                  id={`principal-reason-${id}`}
                  rows={2}
                  maxLength={1000}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder="Add an optional reason…"
                />
              </Field>
            )}
            <p className="text-sm text-slate-500">
              {pending === 'suspend'
                ? 'Suspending takes all of this account’s published listings offline.'
                : 'Restore this account to Active. Previously suspended listings stay suspended until re-published.'}
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={pending === 'suspend' ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void submit(pending)}
              >
                {busy ? (
                  <>
                    <Spinner className="h-4 w-4" /> Working…
                  </>
                ) : pending === 'suspend' ? (
                  'Confirm suspend'
                ) : (
                  'Confirm restore'
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
            {suspended ? (
              <Button size="sm" onClick={() => setPending('restore')}>
                Restore
              </Button>
            ) : (
              <Button size="sm" variant="destructive" onClick={() => setPending('suspend')}>
                Suspend
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Analytics                                                           */
/* ------------------------------------------------------------------ */

function AnalyticsTab() {
  const [data, setData] = useState<PropertyAnalytics | null>(null);
  const [state, setState] = useState<ListState>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const d = await api.get<PropertyAnalytics>('/admin/properties/analytics');
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
        You do not have the <code>properties.read</code> permission required to view analytics.
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
    { label: 'Published listings', value: num(data.activeListings), hint: 'Live (published + under offer)' },
    { label: 'Moderation backlog', value: num(data.approvalBacklog), hint: 'Submitted + under review' },
    { label: 'Open reports', value: num(data.reported) },
    { label: 'For sale', value: num(data.forSale) },
    { label: 'For rent', value: num(data.forRent) },
    { label: 'Enquiries', value: num(data.enquiries) },
    { label: 'Viewings', value: num(data.viewingRequests) },
    { label: 'Active owners', value: num(data.activeOwners) },
    { label: 'Active agents', value: num(data.activeAgents) },
  ];

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {kpis.map((k) => (
          <div key={k.label} className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
            <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{k.label}</p>
            <p className="mt-1 text-2xl font-semibold text-belize-navy">{k.value}</p>
            {k.hint && <p className="mt-0.5 text-xs text-slate-400">{k.hint}</p>}
          </div>
        ))}
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <MiniTable
          title="Published listings by type"
          rows={data.byType.map((t) => ({ label: propertyTypeLabel(t.propertyType), count: t.count }))}
        />
        <MiniTable
          title="Published listings by district"
          rows={data.byDistrict.map((d) => ({ label: districtLabel(d.district) ?? d.district, count: d.count }))}
        />
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
              <span className="w-32 shrink-0 truncate text-sm text-belize-navy" title={r.label}>
                {r.label}
              </span>
              <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-belize-blue"
                  style={{ width: max > 0 ? `${Math.max(4, (r.count / max) * 100)}%` : '0%' }}
                  aria-hidden
                />
              </div>
              <span className="w-10 shrink-0 text-right text-sm font-semibold text-belize-navy">{num(r.count)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
