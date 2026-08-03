'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { relativeTime } from '../../../lib/notifications';
import { StatusBadge } from '../../../components/StatusBadge';
import { Alert, Badge, Button, EmptyState, Field, PageHeader, Select, Spinner, Textarea } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/**
 * Client shapes for the M19 admin reviews moderation console. Mirrors the
 * documented GET /admin/reviews and GET /admin/reviews/reports responses.
 */
type SubjectType = 'PRODUCT' | 'VENDOR' | 'DRIVER';
type ReviewStatus = 'PUBLISHED' | 'HIDDEN' | 'REJECTED';
type ReportStatus = 'OPEN' | 'ACTIONED' | 'DISMISSED';
type ModerateAction = 'HIDE' | 'UNHIDE' | 'REJECT';

interface ReviewMedia {
  id: string;
  url: string | null;
}

interface ReviewResponse {
  body: string;
  createdAt: string;
  editedAt: string | null;
}

interface Review {
  id: string;
  subjectType: SubjectType;
  subjectId: string;
  rating: number;
  title: string | null;
  body: string;
  status: ReviewStatus;
  verifiedPurchase: boolean;
  helpfulCount: number;
  variantName: string | null;
  sku: string | null;
  media: ReviewMedia[];
  response: ReviewResponse | null;
  createdAt: string;
  editedAt: string | null;
  reportCount: number;
  moderationReason: string | null;
}

interface ReportListItem {
  id: string;
  reviewId: string;
  reason: string;
  note: string | null;
  status: ReportStatus;
  createdAt: string;
  review: {
    id: string;
    subjectType: string;
    body: string;
    status: string;
  };
}

type Tab = 'reviews' | 'reports';

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

const REVIEW_STATUS_OPTIONS: Array<{ value: ReviewStatus | ''; label: string }> = [
  { value: '', label: 'All statuses' },
  { value: 'PUBLISHED', label: 'Published' },
  { value: 'HIDDEN', label: 'Hidden' },
  { value: 'REJECTED', label: 'Rejected' },
];

const SUBJECT_OPTIONS: Array<{ value: SubjectType | ''; label: string }> = [
  { value: '', label: 'All types' },
  { value: 'PRODUCT', label: 'Product' },
  { value: 'VENDOR', label: 'Vendor' },
  { value: 'DRIVER', label: 'Driver' },
];

const REPORT_STATUS_OPTIONS: Array<{ value: ReportStatus; label: string }> = [
  { value: 'OPEN', label: 'Open' },
  { value: 'ACTIONED', label: 'Actioned' },
  { value: 'DISMISSED', label: 'Dismissed' },
];

export default function ReviewsPage() {
  const [tab, setTab] = useState<Tab>('reviews');

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs('Reviews')}
        eyebrow="Reviews"
        title="Reviews moderation"
        description="Moderate customer reviews across products, vendors and drivers, and resolve reports flagged by the community."
      />

      <div className="mb-5 flex flex-wrap items-center gap-2" role="tablist" aria-label="Reviews views">
        {(
          [
            { key: 'reviews' as const, label: 'Reviews' },
            { key: 'reports' as const, label: 'Reports' },
          ]
        ).map((t) => {
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

      {tab === 'reviews' ? <ReviewsTab /> : <ReportsTab />}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Reviews tab                                                         */
/* ------------------------------------------------------------------ */

function ReviewsTab() {
  const [status, setStatus] = useState<ReviewStatus | ''>('');
  const [subjectType, setSubjectType] = useState<SubjectType | ''>('');
  const [reportedOnly, setReportedOnly] = useState(false);

  const [items, setItems] = useState<Review[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const params = new URLSearchParams();
      if (status) params.set('status', status);
      if (subjectType) params.set('subjectType', subjectType);
      if (reportedOnly) params.set('reported', 'true');
      const qs = params.toString();
      const rows = await api.get<Review[]>(`/admin/reviews${qs ? `?${qs}` : ''}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status, subjectType, reportedOnly]);

  useEffect(() => {
    void load();
  }, [load]);

  const onModerated = useCallback((updated: Review) => {
    setItems((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
    setNotice(`Review ${updated.status === 'PUBLISHED' ? 'published' : updated.status.toLowerCase()}.`);
  }, []);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[10rem]">
          <Field label="Status" htmlFor="rev-status">
            <Select id="rev-status" value={status} onChange={(e) => setStatus(e.target.value as ReviewStatus | '')}>
              {REVIEW_STATUS_OPTIONS.map((o) => (
                <option key={o.value || 'all'} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <div className="min-w-[10rem]">
          <Field label="Subject type" htmlFor="rev-subject">
            <Select id="rev-subject" value={subjectType} onChange={(e) => setSubjectType(e.target.value as SubjectType | '')}>
              {SUBJECT_OPTIONS.map((o) => (
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

      {listState === 'forbidden' ? (
        <Alert tone="warning" title="You don't have permission">
          You do not have permission to view reviews. The <code>reviews.read</code> permission is required.
        </Alert>
      ) : listState === 'loading' ? (
        <div className="flex items-center gap-2 rounded-bmpl-xl border border-slate-200 bg-white p-6 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading reviews…
        </div>
      ) : listState === 'error' ? (
        <Alert tone="error">
          Could not load reviews.{' '}
          <button type="button" onClick={() => void load()} className="font-semibold underline">
            Retry
          </button>
        </Alert>
      ) : items.length === 0 ? (
        <EmptyState title="No reviews" description="No reviews match the current filters." />
      ) : (
        <ul className="space-y-4">
          {items.map((r) => (
            <ReviewCard key={r.id} review={r} onModerated={onModerated} />
          ))}
        </ul>
      )}
    </div>
  );
}

function Stars({ rating }: { rating: number }) {
  const full = Math.max(0, Math.min(5, Math.round(rating)));
  return (
    <span className="inline-flex items-center gap-1 text-sm font-semibold text-belize-navy" title={`${rating} out of 5`}>
      <span aria-hidden className="text-amber-500">
        {'★'.repeat(full)}
        <span className="text-slate-300">{'★'.repeat(5 - full)}</span>
      </span>
      <span className="sr-only">{rating} out of 5 stars</span>
    </span>
  );
}

function ReviewCard({ review, onModerated }: { review: Review; onModerated: (r: Review) => void }) {
  const [expanded, setExpanded] = useState(false);
  const [pending, setPending] = useState<ModerateAction | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const longBody = review.body.length > 260;
  const shownBody = expanded || !longBody ? review.body : `${review.body.slice(0, 260)}…`;

  async function submit(action: ModerateAction) {
    setBusy(true);
    setError(null);
    try {
      const trimmed = reason.trim();
      const updated = await api.post<Review>(`/admin/reviews/${review.id}/moderate`, {
        action,
        ...(trimmed ? { reason: trimmed } : {}),
      });
      setPending(null);
      setReason('');
      onModerated(updated);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have permission to moderate reviews." : 'Action failed. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="brand">{review.subjectType}</Badge>
          <Stars rating={review.rating} />
          <StatusBadge status={review.status} />
          {review.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
          {review.reportCount > 0 && (
            <Badge tone="error">
              {review.reportCount} {review.reportCount === 1 ? 'report' : 'reports'}
            </Badge>
          )}
        </div>
        <span className="shrink-0 text-xs text-slate-400">{relativeTime(review.createdAt)}</span>
      </div>

      {review.title && <p className="mt-2 text-sm font-semibold text-belize-navy">{review.title}</p>}

      <p className="mt-1 whitespace-pre-wrap break-words text-sm text-belize-navy">{shownBody}</p>
      {longBody && (
        <button type="button" onClick={() => setExpanded((v) => !v)} className="mt-1 text-xs font-semibold text-belize-blue underline">
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-400">
        {review.variantName && <span>Variant: {review.variantName}</span>}
        {review.sku && <span>SKU: {review.sku}</span>}
        <span>{review.helpfulCount} found helpful</span>
        {review.editedAt && <span>edited {relativeTime(review.editedAt)}</span>}
      </div>

      {review.media.some((m) => m.url) && (
        <div className="mt-3 flex flex-wrap gap-2">
          {review.media
            .filter((m) => m.url)
            .map((m) => (
              <a
                key={m.id}
                href={m.url ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                className="block overflow-hidden rounded-bmpl-md border border-slate-200"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url ?? ''} alt="Review media" className="h-20 w-20 object-cover" />
              </a>
            ))}
        </div>
      )}

      {review.response && (
        <div className="mt-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
          <div className="mb-1 flex items-center gap-2">
            <Badge tone="info">Seller response</Badge>
            <span className="text-xs text-slate-400">{relativeTime(review.response.createdAt)}</span>
          </div>
          <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{review.response.body}</p>
        </div>
      )}

      {review.moderationReason && (
        <div className="mt-3">
          <Alert tone="warning" title="Moderation reason">
            {review.moderationReason}
          </Alert>
        </div>
      )}

      {error && (
        <div className="mt-3">
          <Alert tone="error">{error}</Alert>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 border-t border-slate-100 pt-3">
        {pending ? (
          <div className="space-y-2">
            <Field label={`Optional reason${pending === 'REJECT' ? '' : ''}`} htmlFor={`reason-${review.id}`} hint="Optional free text, up to 500 characters.">
              <Textarea
                id={`reason-${review.id}`}
                rows={2}
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Add a reason for this action (optional)…"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant={pending === 'REJECT' ? 'destructive' : 'primary'}
                disabled={busy}
                onClick={() => void submit(pending)}
              >
                {busy ? (
                  <>
                    <Spinner className="h-4 w-4" /> Working…
                  </>
                ) : pending === 'HIDE' ? (
                  'Confirm hide'
                ) : pending === 'UNHIDE' ? (
                  'Confirm unhide'
                ) : (
                  'Confirm reject'
                )}
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPending(null); setReason(''); setError(null); }}>
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {review.status === 'PUBLISHED' && (
              <Button size="sm" variant="outline" onClick={() => setPending('HIDE')}>
                Hide
              </Button>
            )}
            {review.status === 'HIDDEN' && (
              <Button size="sm" variant="outline" onClick={() => setPending('UNHIDE')}>
                Unhide
              </Button>
            )}
            {review.status !== 'REJECTED' && (
              <Button size="sm" variant="destructive" onClick={() => setPending('REJECT')}>
                Reject
              </Button>
            )}
          </div>
        )}
      </div>
    </li>
  );
}

/* ------------------------------------------------------------------ */
/* Reports tab                                                         */
/* ------------------------------------------------------------------ */

function ReportsTab() {
  const [status, setStatus] = useState<ReportStatus>('OPEN');
  const [items, setItems] = useState<ReportListItem[]>([]);
  const [listState, setListState] = useState<'loading' | 'ready' | 'error' | 'forbidden'>('loading');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setListState('loading');
    try {
      const rows = await api.get<ReportListItem[]>(`/admin/reviews/reports?status=${status}`);
      setItems(rows);
      setListState('ready');
    } catch (err) {
      setListState(apiStatus(err) === 403 ? 'forbidden' : 'error');
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  const onResolved = useCallback(
    (id: string, resolvedStatus: 'ACTIONED' | 'DISMISSED') => {
      setItems((prev) => prev.filter((r) => r.id !== id));
      setNotice(`Report ${resolvedStatus === 'ACTIONED' ? 'actioned' : 'dismissed'}.`);
    },
    [],
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end gap-4 rounded-bmpl-xl border border-slate-200 bg-white p-4">
        <div className="min-w-[10rem]">
          <Field label="Report status" htmlFor="report-status">
            <Select id="report-status" value={status} onChange={(e) => setStatus(e.target.value as ReportStatus)}>
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
          You do not have permission to view reports. The <code>reviews.read</code> permission is required.
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
  report: ReportListItem;
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
      await api.post<{ ok: true }>(`/admin/reviews/reports/${report.id}/resolve`, {
        status: resolveStatus,
        ...(trimmed ? { note: trimmed } : {}),
      });
      onResolved(report.id, resolveStatus);
    } catch (err) {
      setError(apiStatus(err) === 403 ? "You don't have permission to resolve reports." : 'Action failed. Please try again.');
      setBusy(false);
    }
  }

  return (
    <li className="rounded-bmpl-xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <Badge tone="error">{report.reason}</Badge>
          <StatusBadge status={report.status} />
        </div>
        <span className="shrink-0 text-xs text-slate-400">{relativeTime(report.createdAt)}</span>
      </div>

      {report.note && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-700">{report.note}</p>}

      <div className="mt-3 rounded-bmpl-lg border border-slate-200 bg-slate-50 p-3">
        <div className="mb-1 flex flex-wrap items-center gap-2">
          <Badge tone="brand">{report.review.subjectType}</Badge>
          <StatusBadge status={report.review.status} />
        </div>
        <p className="whitespace-pre-wrap break-words text-sm text-slate-700">{report.review.body}</p>
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
              <Field label="Optional note" htmlFor={`note-${report.id}`} hint="Optional free text, up to 500 characters.">
                <Textarea
                  id={`note-${report.id}`}
                  rows={2}
                  maxLength={500}
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
                <Button size="sm" variant="outline" disabled={busy} onClick={() => { setPending(null); setNote(''); setError(null); }}>
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
