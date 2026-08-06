'use client';

import { useCallback, useEffect, useState } from 'react';
import { Alert, Badge, Button, EmptyState, Field, Select, Spinner, Textarea } from '../ui';
import { StarRating } from './StarRating';
import { Avatar } from '../Avatar';
import { relativeTime } from '../../lib/notifications';
import { api, type ApiError } from '../../lib/api';
import {
  REPORT_REASONS,
  REVIEW_LIMITS,
  REVIEW_PAGE_SIZE,
  REVIEW_SORTS,
  fetchSubjectReviews,
  type RatingAggregate,
  type ReportReason,
  type Review,
  type ReviewListResponse,
  type ReviewSort,
  type ReviewSubjectType,
} from '../../lib/reviews';

const RATING_KEYS = [5, 4, 3, 2, 1] as const;

/** Aggregate header: big average, stars, count and a 5→1 distribution chart. */
function AggregateHeader({ aggregate }: { aggregate: RatingAggregate }) {
  const { average, count, distribution } = aggregate;
  return (
    <div className="flex flex-col gap-5 rounded-bmpl-lg border border-slate-200 bg-white p-5 shadow-bmpl-sm sm:flex-row sm:items-center sm:gap-8">
      <div className="flex shrink-0 flex-col items-center text-center">
        <span className="text-4xl font-bold text-belize-navy">{count > 0 ? average.toFixed(1) : '—'}</span>
        <StarRating value={average} size="md" className="mt-1" />
        <span className="mt-1 text-xs text-slate-500">
          {count > 0 ? `${count} review${count === 1 ? '' : 's'}` : 'No reviews yet'}
        </span>
      </div>
      <div className="flex-1 space-y-1.5">
        {RATING_KEYS.map((r) => {
          const n = distribution[String(r) as '1' | '2' | '3' | '4' | '5'] ?? 0;
          const pct = count > 0 ? Math.round((n / count) * 100) : 0;
          return (
            <div key={r} className="flex items-center gap-2 text-xs text-slate-500">
              <span className="w-8 shrink-0 tabular-nums">{r} ★</span>
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <span className="block h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
              </span>
              <span className="w-8 shrink-0 text-right tabular-nums">{n}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Inline report reason picker for a single review. */
function ReportForm({ reviewId, onDone, onCancel }: { reviewId: string; onDone: () => void; onCancel: () => void }) {
  const [reason, setReason] = useState<ReportReason>('SPAM');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  async function submit() {
    setBusy(true);
    setMsg(null);
    try {
      await api.post(`/reviews/${reviewId}/report`, { reason, note: note.trim() || undefined });
      setMsg({ kind: 'ok', text: 'Thanks — this review has been reported for moderation.' });
      setTimeout(onDone, 1200);
    } catch (e) {
      const err = e as ApiError;
      setMsg({
        kind: 'err',
        text: err.status === 401 ? 'Please log in to report a review.' : err.message || 'Could not submit the report.',
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
      {msg && (
        <Alert tone={msg.kind === 'ok' ? 'success' : 'error'} className="mb-3">
          {msg.text}
        </Alert>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Reason" htmlFor={`report-reason-${reviewId}`}>
          <Select
            id={`report-reason-${reviewId}`}
            value={reason}
            onChange={(e) => setReason(e.target.value as ReportReason)}
          >
            {REPORT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Note" htmlFor={`report-note-${reviewId}`} hint="Optional">
          <Textarea
            id={`report-note-${reviewId}`}
            rows={2}
            maxLength={REVIEW_LIMITS.noteMax}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add any context (optional)"
          />
        </Field>
      </div>
      <div className="mt-3 flex gap-2">
        <Button type="button" size="sm" variant="destructive" disabled={busy} onClick={submit}>
          {busy ? 'Submitting…' : 'Submit report'}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** A single review row. */
function ReviewRow({ review }: { review: Review }) {
  const [helpfulCount, setHelpfulCount] = useState(review.helpfulCount);
  const [voted, setVoted] = useState(review.votedHelpful);
  const [voteBusy, setVoteBusy] = useState(false);
  const [authHint, setAuthHint] = useState<string | null>(null);
  const [reporting, setReporting] = useState(false);

  async function toggleHelpful() {
    setVoteBusy(true);
    setAuthHint(null);
    try {
      const res = await api.post<{ helpful: boolean }>(`/reviews/${review.id}/helpful`);
      setVoted(res.helpful);
      setHelpfulCount((c) => c + (res.helpful ? 1 : -1));
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) setAuthHint('Log in to vote.');
      else setAuthHint(err.message || 'Could not record your vote.');
    } finally {
      setVoteBusy(false);
    }
  }

  const media = review.media.filter((m) => m.url);

  return (
    <li className="border-b border-slate-100 py-5 last:border-b-0">
      <div className="flex items-center gap-2.5">
        <Avatar
          name={review.reviewer.name}
          src={review.reviewer.avatarUrl}
          initials={review.reviewer.initials}
          size="sm"
        />
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-belize-navy">{review.reviewer.name}</p>
          <span className="text-xs text-slate-400">{relativeTime(review.createdAt)}</span>
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-2">
        <StarRating value={review.rating} size="sm" />
        {review.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
        {review.isMine && <Badge tone="brand">Your review</Badge>}
      </div>

      {review.title && <p className="mt-2 font-semibold text-belize-navy">{review.title}</p>}
      {review.variantName && <p className="mt-0.5 text-xs text-slate-500">{review.variantName}</p>}
      <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">{review.body}</p>

      {media.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {media.map((m) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={m.id}
              src={m.url as string}
              alt="Review photo"
              className="h-16 w-16 rounded-bmpl-md border border-slate-200 object-cover"
            />
          ))}
        </div>
      )}

      {review.response && (
        <div className="mt-3 rounded-bmpl-md border-l-2 border-belize-blue/40 bg-belize-blue/5 p-3">
          <p className="bmpl-eyebrow mb-1">Response from the seller</p>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{review.response.body}</p>
          <p className="mt-1 text-xs text-slate-400">{relativeTime(review.response.createdAt)}</p>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={toggleHelpful}
          disabled={voteBusy}
          aria-pressed={voted}
          className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition disabled:opacity-60 ${
            voted
              ? 'border-belize-blue bg-belize-blue/10 text-belize-blue'
              : 'border-slate-300 text-slate-600 hover:border-belize-blue hover:text-belize-blue'
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" className="h-3.5 w-3.5" aria-hidden>
            <path d="M7 11v9H4v-9h3Zm4 9h6a2 2 0 0 0 2-1.6l1.2-6A2 2 0 0 0 18.2 9H14l.6-3a2 2 0 0 0-2-2.4L11 9v11Z" />
          </svg>
          Helpful ({helpfulCount})
        </button>
        {authHint && <span className="text-xs text-amber-600">{authHint}</span>}
        {!review.isMine && (
          <button
            type="button"
            onClick={() => setReporting((v) => !v)}
            className="text-xs font-medium text-slate-400 hover:text-slate-600 hover:underline"
          >
            {reporting ? 'Close' : 'Report'}
          </button>
        )}
      </div>

      {reporting && <ReportForm reviewId={review.id} onDone={() => setReporting(false)} onCancel={() => setReporting(false)} />}
    </li>
  );
}

/**
 * Full public reviews section for a subject. Owns its own fetching, loading,
 * empty and error states, sort/filter controls and pagination.
 */
export function ReviewList({
  subjectType,
  subjectId,
  onAggregate,
}: {
  subjectType: ReviewSubjectType;
  subjectId: string;
  /** Optional callback so a parent can show a compact summary from the same fetch. */
  onAggregate?: (aggregate: RatingAggregate) => void;
}) {
  const [sort, setSort] = useState<'' | ReviewSort>('');
  const [rating, setRating] = useState<number | null>(null);
  const [page, setPage] = useState(1);

  const [data, setData] = useState<ReviewListResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetchSubjectReviews(subjectType, subjectId, { sort, rating, page });
      setData(res);
      onAggregate?.(res.aggregate);
    } catch {
      setError('Could not load reviews.');
    } finally {
      setLoading(false);
    }
    // onAggregate intentionally omitted — parent may pass a new fn each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [subjectType, subjectId, sort, rating, page]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = data ? Math.max(1, Math.ceil(data.total / (data.pageSize || REVIEW_PAGE_SIZE))) : 1;

  return (
    <div className="space-y-5">
      {data && <AggregateHeader aggregate={data.aggregate} />}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter by rating">
          {([null, 5, 4, 3, 2, 1] as const).map((r) => {
            const active = rating === r;
            return (
              <button
                key={r ?? 'all'}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setRating(r);
                  setPage(1);
                }}
                className={`rounded-full border px-3 py-1 text-xs font-semibold transition ${
                  active
                    ? 'border-belize-blue bg-belize-blue/10 text-belize-blue'
                    : 'border-slate-300 text-slate-600 hover:border-belize-blue'
                }`}
              >
                {r == null ? 'All' : `${r} ★`}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-2 text-xs text-slate-500">
          Sort
          <Select
            aria-label="Sort reviews"
            className="w-auto"
            value={sort}
            onChange={(e) => {
              setSort(e.target.value as '' | ReviewSort);
              setPage(1);
            }}
          >
            {REVIEW_SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading reviews…
        </div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : !data || data.reviews.length === 0 ? (
        <EmptyState
          title={rating != null ? 'No reviews match this filter' : 'No reviews yet'}
          description={rating != null ? 'Try clearing the rating filter.' : 'Be the first to share your experience.'}
        />
      ) : (
        <>
          <ul className="rounded-bmpl-lg border border-slate-200 bg-white px-5 shadow-bmpl-sm">
            {data.reviews.map((r) => (
              <ReviewRow key={r.id} review={r} />
            ))}
          </ul>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
              >
                ← Previous
              </Button>
              <span className="text-xs text-slate-500">
                Page {data.page} of {totalPages}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
              >
                Next →
              </Button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
