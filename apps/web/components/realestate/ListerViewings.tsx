'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  VIEWING_TRANSITIONS,
  type ViewingRequestStatus,
} from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import {
  type ViewingCard,
  type ViewingTransitionInput,
  fmtDate,
  fmtDateTime,
  viewingStatusLabel,
} from '../../lib/realestate';
import { VIEWING_STATUS_TONE } from './status';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner, Textarea } from '../ui';

export interface ViewingsApi {
  viewings: (params?: { listingId?: string; status?: string }) => Promise<ViewingCard[]>;
  transitionViewing: (id: string, body: ViewingTransitionInput) => Promise<unknown>;
}

/** Received viewing requests with lister-driven transitions (validated by the shared map). */
export function ViewingsInbox({
  api,
  eyebrow,
  onForbidden,
}: {
  api: ViewingsApi;
  eyebrow: string;
  onForbidden: () => void;
}) {
  const [items, setItems] = useState<ViewingCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setItems(await api.viewings());
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) onForbidden();
      else setError(err.message ?? 'Failed to load viewing requests.');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={eyebrow} title="Viewings" description="Viewing requests received on your listings." />
      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState title="No viewing requests" description="Requests to view your listings will appear here." />
      ) : (
        <div className="space-y-3">
          {items?.map((v) => (
            <Card key={v.id} className="space-y-3 p-5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <p className="font-semibold text-belize-navy">{v.listing.title}</p>
                  <p className="text-xs text-slate-500">
                    {v.requester ? `${v.requester} · ` : ''}requested {fmtDate(v.requestedDate)}
                    {v.requestedTime ? ` · ${v.requestedTime}` : ''}
                  </p>
                  {v.confirmedDate && (
                    <p className="text-xs text-emerald-600">
                      Confirmed {fmtDate(v.confirmedDate)}
                      {v.confirmedTime ? ` · ${v.confirmedTime}` : ''}
                    </p>
                  )}
                </div>
                <Badge tone={VIEWING_STATUS_TONE[v.status]}>{viewingStatusLabel(v.status)}</Badge>
              </div>
              {(VIEWING_TRANSITIONS[v.status] ?? []).length > 0 && (
                <div>
                  {openId === v.id ? (
                    <TransitionForm
                      viewing={v}
                      onCancel={() => setOpenId(null)}
                      onSubmit={async (body) => {
                        await api.transitionViewing(v.id, body);
                        setOpenId(null);
                        await load();
                      }}
                    />
                  ) : (
                    <Button size="sm" variant="outline" onClick={() => setOpenId(v.id)}>
                      Respond
                    </Button>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function TransitionForm({
  viewing,
  onCancel,
  onSubmit,
}: {
  viewing: ViewingCard;
  onCancel: () => void;
  onSubmit: (body: ViewingTransitionInput) => Promise<void>;
}) {
  const options = VIEWING_TRANSITIONS[viewing.status] ?? [];
  const [status, setStatus] = useState<ViewingRequestStatus>(options[0] ?? 'CANCELLED');
  const [confirmedDate, setConfirmedDate] = useState(
    viewing.confirmedDate?.slice(0, 10) ?? viewing.requestedDate.slice(0, 10),
  );
  const [confirmedTime, setConfirmedTime] = useState(viewing.confirmedTime ?? viewing.requestedTime ?? '');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needsTime = status === 'CONFIRMED' || status === 'PROPOSED' || status === 'RESCHEDULED';
  const needsReason = status === 'CANCELLED' || status === 'DECLINED';

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await onSubmit({
        status,
        confirmedDate: needsTime && confirmedDate ? confirmedDate : undefined,
        confirmedTime: needsTime && confirmedTime ? confirmedTime : undefined,
        note: note.trim() || undefined,
        cancellationReason: needsReason ? note.trim() || undefined : undefined,
      });
    } catch (e2) {
      setError((e2 as ApiError).message ?? 'Could not update the viewing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Move to">
        <Select value={status} onChange={(e) => setStatus(e.target.value as ViewingRequestStatus)}>
          {options.map((s) => (
            <option key={s} value={s}>
              {viewingStatusLabel(s)}
            </option>
          ))}
        </Select>
      </Field>
      {needsTime && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Confirmed date">
            <Input type="date" value={confirmedDate} onChange={(e) => setConfirmedDate(e.target.value)} />
          </Field>
          <Field label="Confirmed time">
            <Input type="time" value={confirmedTime} onChange={(e) => setConfirmedTime(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label={needsReason ? 'Reason (optional)' : 'Note (optional)'}>
        <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
      </Field>
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={busy}>
          {busy ? 'Saving…' : 'Update'}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
      <p className="text-[11px] text-slate-400">Requested for {fmtDateTime(viewing.createdAt)}</p>
    </form>
  );
}
