'use client';

import { useCallback, useEffect, useState } from 'react';
import { PageHeader, Card, Badge, StatusBadge, Button, Field, Input, Textarea, Alert, Spinner, EmptyState } from '../../../components/ui';
import { StarInput, StarRating } from '../../../components/reviews/StarRating';
import { relativeTime } from '../../../lib/notifications';
import { api, type ApiError } from '../../../lib/api';
import {
  PROFILE_LABELS,
  REVIEW_LIMITS,
  type EligibleContext,
  type Review,
} from '../../../lib/reviews';

function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}

type Tab = 'write' | 'mine';

export default function CustomerReviewsPage() {
  const [tab, setTab] = useState<Tab>('write');
  const [flash, setFlash] = useState<string | null>(null);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader title="My Reviews" description="Share your experience and manage the reviews you've written." />

      {flash && <Alert tone="success">{flash}</Alert>}

      <div className="inline-flex overflow-hidden rounded-bmpl-md border border-slate-200" role="tablist" aria-label="Reviews">
        {(
          [
            { id: 'write', label: 'Write a review' },
            { id: 'mine', label: 'My reviews' },
          ] as const
        ).map((t, i) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`px-4 py-2 text-sm font-semibold transition ${i > 0 ? 'border-l border-slate-200' : ''} ${
              tab === t.id ? 'bg-belize-blue text-white' : 'bg-white text-slate-600 hover:bg-slate-50'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'write' ? <WriteReviewTab onPosted={(msg) => setFlash(msg)} /> : <MyReviewsTab />}
    </div>
  );
}

/* ------------------------------------------------------------- write a review */

function WriteReviewTab({ onPosted }: { onPosted: (msg: string) => void }) {
  const [items, setItems] = useState<EligibleContext[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.get<EligibleContext[]>('/reviews/eligible'));
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 401 ? 'Please log in to write a review.' : errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function removeItem(ctx: EligibleContext) {
    setItems((prev) => (prev ? prev.filter((i) => !(i.subjectType === ctx.subjectType && i.contextId === ctx.contextId)) : prev));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items || items.length === 0) {
    return <EmptyState title="Nothing to review right now" description="Once you've completed an order, eligible items will appear here." />;
  }

  return (
    <div className="space-y-4">
      {items.map((ctx) => (
        <EligibleItem
          key={`${ctx.subjectType}:${ctx.contextId}`}
          ctx={ctx}
          onPosted={() => {
            removeItem(ctx);
            onPosted('Thanks — your review has been submitted.');
          }}
        />
      ))}
    </div>
  );
}

function EligibleItem({ ctx, onPosted }: { ctx: EligibleContext; onPosted: () => void }) {
  const [rating, setRating] = useState(0);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (rating < 1 || body.trim().length === 0) {
      setError('Please give a star rating and write your review.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post<Review>('/reviews', {
        subjectType: ctx.subjectType,
        contextId: ctx.contextId,
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
      });
      onPosted();
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-semibold text-belize-navy">{ctx.label}</p>
          <p className="text-xs text-slate-500">
            Order {ctx.orderNumber} · {PROFILE_LABELS[ctx.subjectType]}
          </p>
        </div>
        <Badge tone="brand">{PROFILE_LABELS[ctx.subjectType]}</Badge>
      </div>

      {error && (
        <Alert tone="error" className="mt-3">
          {error}
        </Alert>
      )}

      <div className="mt-4 space-y-3">
        <div>
          <span className="bmpl-label">Your rating</span>
          <div className="mt-1">
            <StarInput value={rating} onChange={setRating} />
          </div>
        </div>
        <Field label="Title" htmlFor={`title-${ctx.contextId}`} hint="Optional">
          <Input
            id={`title-${ctx.contextId}`}
            maxLength={REVIEW_LIMITS.titleMax}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Sum it up in a few words"
          />
        </Field>
        <Field label="Review" htmlFor={`body-${ctx.contextId}`}>
          <Textarea
            id={`body-${ctx.contextId}`}
            rows={4}
            required
            maxLength={REVIEW_LIMITS.bodyMax}
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="What did you like or dislike?"
          />
        </Field>
        <Button type="button" disabled={busy || rating < 1 || body.trim().length === 0} onClick={submit}>
          {busy ? 'Submitting…' : 'Submit review'}
        </Button>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------- my reviews */

function MyReviewsTab() {
  const [items, setItems] = useState<Review[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setItems(await api.get<Review[]>('/reviews/mine'));
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 401 ? 'Please log in to see your reviews.' : errMessage(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function replaceItem(updated: Review) {
    setItems((prev) => (prev ? prev.map((r) => (r.id === updated.id ? updated : r)) : prev));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!items || items.length === 0) {
    return <EmptyState title="You haven't written any reviews yet" description="Reviews you write will appear here." />;
  }

  return (
    <div className="space-y-4">
      {items.map((r) => (
        <MyReviewRow key={r.id} review={r} onUpdated={replaceItem} />
      ))}
    </div>
  );
}

function MyReviewRow({ review, onUpdated }: { review: Review; onUpdated: (r: Review) => void }) {
  const [editing, setEditing] = useState(false);
  const [rating, setRating] = useState(review.rating);
  const [title, setTitle] = useState(review.title ?? '');
  const [body, setBody] = useState(review.body);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canEdit = review.status !== 'REJECTED';

  function startEdit() {
    setRating(review.rating);
    setTitle(review.title ?? '');
    setBody(review.body);
    setError(null);
    setEditing(true);
  }

  async function save() {
    if (rating < 1 || body.trim().length === 0) {
      setError('Please give a star rating and write your review.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Review>(`/reviews/${review.id}`, {
        rating,
        title: title.trim() || undefined,
        body: body.trim(),
      });
      onUpdated(updated);
      setEditing(false);
    } catch (e) {
      setError(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StarRating value={review.rating} size="sm" />
          <StatusBadge status={review.status} />
          {review.verifiedPurchase && <Badge tone="success">Verified purchase</Badge>}
        </div>
        <span className="text-xs text-slate-400">{relativeTime(review.editedAt ?? review.createdAt)}</span>
      </div>

      {editing ? (
        <div className="mt-4 space-y-3">
          {error && <Alert tone="error">{error}</Alert>}
          <div>
            <span className="bmpl-label">Your rating</span>
            <div className="mt-1">
              <StarInput value={rating} onChange={setRating} />
            </div>
          </div>
          <Field label="Title" htmlFor={`edit-title-${review.id}`} hint="Optional">
            <Input id={`edit-title-${review.id}`} maxLength={REVIEW_LIMITS.titleMax} value={title} onChange={(e) => setTitle(e.target.value)} />
          </Field>
          <Field label="Review" htmlFor={`edit-body-${review.id}`}>
            <Textarea
              id={`edit-body-${review.id}`}
              rows={4}
              required
              maxLength={REVIEW_LIMITS.bodyMax}
              value={body}
              onChange={(e) => setBody(e.target.value)}
            />
          </Field>
          <div className="flex gap-2">
            <Button type="button" size="sm" disabled={busy} onClick={save}>
              {busy ? 'Saving…' : 'Save changes'}
            </Button>
            <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {review.title && <p className="mt-3 font-semibold text-belize-navy">{review.title}</p>}
          <p className="mt-1.5 whitespace-pre-wrap text-sm text-slate-600">{review.body}</p>
          {review.response && (
            <div className="mt-3 rounded-bmpl-md border-l-2 border-belize-blue/40 bg-belize-blue/5 p-3">
              <p className="bmpl-eyebrow mb-1">Response from the seller</p>
              <p className="whitespace-pre-wrap text-sm text-slate-600">{review.response.body}</p>
            </div>
          )}
          {canEdit && (
            <div className="mt-3">
              <Button type="button" size="sm" variant="outline" onClick={startEdit}>
                Edit
              </Button>
            </div>
          )}
        </>
      )}
    </Card>
  );
}
