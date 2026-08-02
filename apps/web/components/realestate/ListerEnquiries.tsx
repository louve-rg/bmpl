'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { type ApiError } from '../../lib/api';
import {
  type EnquiryCard,
  type ListerEnquiryDetail,
  fmtDateTime,
  enquiryTypeLabel,
  enquiryStatusLabel,
} from '../../lib/realestate';
import { ENQUIRY_STATUS_TONE } from './status';
import { Alert, Badge, Button, Card, EmptyState, Field, PageHeader, Spinner, Textarea } from '../ui';

export interface EnquiriesApi {
  enquiries: (params?: { listingId?: string; status?: string }) => Promise<EnquiryCard[]>;
  enquiry: (id: string) => Promise<ListerEnquiryDetail>;
  replyEnquiry: (id: string, message: string) => Promise<ListerEnquiryDetail>;
  closeEnquiry: (id: string) => Promise<ListerEnquiryDetail>;
}

/** Received-enquiries list for an owner or agent. `detailBase` is the route prefix for detail links. */
export function EnquiriesInbox({
  api,
  eyebrow,
  detailBase,
  onForbidden,
}: {
  api: EnquiriesApi;
  eyebrow: string;
  detailBase: string;
  onForbidden: () => void;
}) {
  const [items, setItems] = useState<EnquiryCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .enquiries()
      .then((r) => active && setItems(r))
      .catch((e) => {
        if (!active) return;
        const err = e as ApiError;
        if (err.status === 403) onForbidden();
        else setError(err.message ?? 'Failed to load enquiries.');
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader eyebrow={eyebrow} title="Enquiries" description="Enquiries received on your listings." />
      {error && <Alert tone="error">{error}</Alert>}

      {items === null && !error ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : items && items.length === 0 ? (
        <EmptyState title="No enquiries yet" description="Enquiries about your listings will appear here." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Property</th>
                <th className="px-4 py-3">From</th>
                <th className="px-4 py-3">Type</th>
                <th className="px-4 py-3">Received</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {items?.map((e) => (
                <tr key={e.id} className="border-t border-slate-100 hover:bg-slate-50">
                  <td className="px-4 py-3 font-medium text-belize-navy">{e.listing.title}</td>
                  <td className="px-4 py-3 text-slate-600">{e.enquirer ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-600">{enquiryTypeLabel(e.type)}</td>
                  <td className="px-4 py-3 text-xs text-slate-500">{fmtDateTime(e.createdAt)}</td>
                  <td className="px-4 py-3">
                    <Badge tone={ENQUIRY_STATUS_TONE[e.status]}>{enquiryStatusLabel(e.status)}</Badge>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link href={`${detailBase}/${e.id}`} className="text-xs font-semibold text-belize-blue hover:underline">
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** Received-enquiry detail with reply + close for an owner or agent. */
export function EnquiryThread({
  api,
  id,
  eyebrow,
  listPath,
  onForbidden,
}: {
  api: EnquiriesApi;
  id: string;
  eyebrow: string;
  listPath: string;
  onForbidden: () => void;
}) {
  const [enquiry, setEnquiry] = useState<ListerEnquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reply, setReply] = useState('');
  const [busy, setBusy] = useState(false);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEnquiry(await api.enquiry(id));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) onForbidden();
      else setError(err.status === 404 ? 'Enquiry not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function sendReply(e: React.FormEvent) {
    e.preventDefault();
    if (!reply.trim()) return;
    setAction(null);
    setBusy(true);
    try {
      setEnquiry(await api.replyEnquiry(id, reply.trim()));
      setReply('');
    } catch (e2) {
      setAction((e2 as ApiError).message ?? 'Could not send reply.');
    } finally {
      setBusy(false);
    }
  }

  async function close() {
    setAction(null);
    try {
      setEnquiry(await api.closeEnquiry(id));
    } catch (e) {
      setAction((e as ApiError).message ?? 'Could not close.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href={listPath} className="text-sm font-medium text-belize-blue hover:underline">
        ← Enquiries
      </Link>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : error ? (
        <Alert tone="error">{error}</Alert>
      ) : enquiry ? (
        <>
          <PageHeader
            eyebrow={eyebrow}
            title={enquiry.listing.title}
            description={`${enquiryTypeLabel(enquiry.type)} · from ${enquiry.enquirer.name}`}
            actions={
              <Link href={`/properties/${enquiry.listing.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
                View property
              </Link>
            }
          />
          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={ENQUIRY_STATUS_TONE[enquiry.status]}>{enquiryStatusLabel(enquiry.status)}</Badge>
            {enquiry.status !== 'CLOSED' && (
              <Button size="sm" variant="ghost" onClick={close}>
                Close enquiry
              </Button>
            )}
          </div>
          {action && <Alert tone="error">{action}</Alert>}

          <Card className="space-y-2 p-5">
            <h2 className="text-base font-bold text-belize-navy">Message</h2>
            <p className="whitespace-pre-line text-sm text-slate-600">{enquiry.message}</p>
            <p className="text-xs text-slate-400">
              {enquiry.enquirer.email}
              {enquiry.contactPhone ? ` · ${enquiry.contactPhone}` : ''}
            </p>
          </Card>

          {enquiry.status !== 'CLOSED' && (
            <Card className="space-y-3 p-5">
              <h2 className="text-base font-bold text-belize-navy">Reply</h2>
              <form onSubmit={sendReply} className="space-y-3">
                <Field label="Your reply">
                  <Textarea rows={3} value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply…" />
                </Field>
                <Button type="submit" size="sm" disabled={busy}>
                  {busy ? 'Sending…' : 'Send reply'}
                </Button>
                <p className="text-xs text-slate-400">
                  Replies post to the shared conversation — continue it in{' '}
                  <Link href="/dashboard/messages" className="font-medium text-belize-blue hover:underline">
                    messages
                  </Link>
                  .
                </p>
              </form>
            </Card>
          )}
        </>
      ) : null}
    </div>
  );
}
