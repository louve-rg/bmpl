'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { realEstateApi } from '../../lib/realestate';
import type { ApiError } from '../../lib/api';
import { Alert, Button, Field, Input, Textarea } from '../ui';

/** Viewing-request form on the public property detail. */
export function ViewingRequestForm({ listingId, slug }: { listingId: string; slug: string }) {
  const router = useRouter();
  const [requestedDate, setRequestedDate] = useState('');
  const [requestedTime, setRequestedTime] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!requestedDate) {
      setError('Choose a preferred date.');
      return;
    }
    setBusy(true);
    try {
      await realEstateApi.seeker.createViewing({
        listingId,
        requestedDate,
        requestedTime: requestedTime.trim() || undefined,
        message: message.trim() || undefined,
      });
      setDone(true);
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/properties/${slug}`)}`);
        return;
      }
      setError(e2.message ?? 'Unable to request a viewing.');
    } finally {
      setBusy(false);
    }
  }

  if (done) {
    return (
      <Alert tone="success" title="Viewing requested">
        The lister will propose or confirm a time. Track it under{' '}
        <a href="/dashboard/properties/viewings" className="font-semibold underline">
          My viewings
        </a>
        .
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Preferred date">
          <Input type="date" value={requestedDate} onChange={(e) => setRequestedDate(e.target.value)} />
        </Field>
        <Field label="Preferred time (optional)">
          <Input type="time" value={requestedTime} onChange={(e) => setRequestedTime(e.target.value)} />
        </Field>
      </div>
      <Field label="Message (optional)">
        <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} />
      </Field>
      <Button type="submit" variant="outline" className="w-full" disabled={busy}>
        {busy ? 'Requesting…' : 'Request a viewing'}
      </Button>
    </form>
  );
}
