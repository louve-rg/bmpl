'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { PROPERTY_ENQUIRY_TYPES, type PropertyEnquiryType } from '@bmpl/shared';
import { realEstateApi, enquiryTypeLabel } from '../../lib/realestate';
import type { ApiError } from '../../lib/api';
import { Alert, Button, Field, Select, Textarea } from '../ui';

/** Enquiry form on the public property detail. Opens a scoped messaging thread on submit. */
export function EnquiryForm({ listingId, slug }: { listingId: string; slug: string }) {
  const router = useRouter();
  const [type, setType] = useState<PropertyEnquiryType>('GENERAL');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [enquiryId, setEnquiryId] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (message.trim().length < 2) {
      setError('Please write a short message.');
      return;
    }
    setBusy(true);
    try {
      const created = await realEstateApi.seeker.createEnquiry({
        listingId,
        type,
        message: message.trim(),
      });
      setEnquiryId(created.id);
      setMessage('');
    } catch (err) {
      const e2 = err as ApiError;
      if (e2.status === 401) {
        router.push(`/login?next=${encodeURIComponent(`/properties/${slug}`)}`);
        return;
      }
      setError(e2.message ?? 'Unable to send your enquiry.');
    } finally {
      setBusy(false);
    }
  }

  async function openConversation() {
    if (!enquiryId) return;
    try {
      await realEstateApi.seeker.openEnquiryConversation(enquiryId);
      router.push('/dashboard/messages');
    } catch (err) {
      setError((err as ApiError).message ?? 'Could not open the conversation.');
    }
  }

  if (enquiryId) {
    return (
      <Alert tone="success" title="Enquiry sent">
        <p>The lister has been notified. Continue the conversation in your inbox.</p>
        <Button size="sm" variant="outline" className="mt-2" onClick={openConversation}>
          Open conversation
        </Button>
      </Alert>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      {error && <Alert tone="error">{error}</Alert>}
      <Field label="Enquiry type">
        <Select value={type} onChange={(e) => setType(e.target.value as PropertyEnquiryType)}>
          {PROPERTY_ENQUIRY_TYPES.map((t) => (
            <option key={t} value={t}>
              {enquiryTypeLabel(t)}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Message">
        <Textarea
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="I'm interested in this property…"
        />
      </Field>
      <Button type="submit" className="w-full" disabled={busy}>
        {busy ? 'Sending…' : 'Send enquiry'}
      </Button>
    </form>
  );
}
