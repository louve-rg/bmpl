'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { type ApiError } from '../../../../../lib/api';
import {
  realEstateApi,
  fmtDateTime,
  enquiryTypeLabel,
  enquiryStatusLabel,
  type EnquiryDetail,
} from '../../../../../lib/realestate';
import { ENQUIRY_STATUS_TONE } from '../../../../../components/realestate/status';
import { Alert, Badge, Button, Card, PageHeader, Spinner } from '../../../../../components/ui';

export default function EnquiryDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [enquiry, setEnquiry] = useState<EnquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [action, setAction] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEnquiry(await realEstateApi.seeker.enquiry(id));
      setError(null);
    } catch (e) {
      const err = e as ApiError;
      setError(err.status === 404 ? 'Enquiry not found.' : err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    void load();
  }, [load]);

  async function openConversation() {
    setAction(null);
    try {
      await realEstateApi.seeker.openEnquiryConversation(id);
      router.push('/dashboard/messages');
    } catch (e) {
      setAction((e as ApiError).message ?? 'Could not open the conversation.');
    }
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <Link href="/dashboard/properties/enquiries" className="text-sm font-medium text-belize-blue hover:underline">
        ← My enquiries
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
            eyebrow="Real Estate"
            title={enquiry.listing.title}
            description={`${enquiryTypeLabel(enquiry.type)} · sent ${fmtDateTime(enquiry.createdAt)}`}
            actions={
              <Link href={`/properties/${enquiry.listing.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
                View property
              </Link>
            }
          />

          <div className="flex flex-wrap items-center gap-3">
            <Badge tone={ENQUIRY_STATUS_TONE[enquiry.status]}>{enquiryStatusLabel(enquiry.status)}</Badge>
            <Button size="sm" variant="outline" onClick={openConversation}>
              Open conversation
            </Button>
          </div>
          {action && <Alert tone="error">{action}</Alert>}

          <Card className="space-y-2 p-5">
            <h2 className="text-base font-bold text-belize-navy">Your message</h2>
            <p className="whitespace-pre-line text-sm text-slate-600">{enquiry.message}</p>
          </Card>

          <Card className="space-y-2 p-5">
            <h2 className="text-base font-bold text-belize-navy">Details</h2>
            <p className="text-sm text-slate-600">Reference: {enquiry.listing.reference}</p>
            {enquiry.respondedAt && <p className="text-sm text-slate-600">Responded: {fmtDateTime(enquiry.respondedAt)}</p>}
            {enquiry.closedAt && <p className="text-sm text-slate-600">Closed: {fmtDateTime(enquiry.closedAt)}</p>}
            <p className="text-xs text-slate-400">
              Replies from the lister arrive in your{' '}
              <Link href="/dashboard/messages" className="font-medium text-belize-blue hover:underline">
                messages
              </Link>
              .
            </p>
          </Card>
        </>
      ) : null}
    </div>
  );
}
