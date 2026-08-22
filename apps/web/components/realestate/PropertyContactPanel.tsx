'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { Card, ButtonLink, Spinner } from '../ui';
import { EnquiryForm } from './EnquiryForm';
import { ViewingRequestForm } from './ViewingRequestForm';

/**
 * Contact widgets for the public property detail. Enquiry + viewing forms are only
 * actionable for a signed-in customer; guests get a sign-in prompt instead.
 */
export function PropertyContactPanel({ listingId, slug }: { listingId: string; slug: string }) {
  const [me, setMe] = useState<MeView | null | undefined>(undefined);

  useEffect(() => {
    let active = true;
    api
      .get<MeView>('/me')
      .then((m) => active && setMe(m))
      .catch(() => active && setMe(null));
    return () => {
      active = false;
    };
  }, []);

  if (me === undefined) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </Card>
    );
  }

  if (me === null) {
    return (
      <Card className="space-y-3 p-5">
        <p className="bmpl-eyebrow">Interested?</p>
        <p className="text-sm text-slate-600">
          Sign in to inquire about this property or request a viewing.
        </p>
        <ButtonLink
          href={`/login?next=${encodeURIComponent(`/properties/${slug}`)}`}
          size="lg"
          className="w-full"
        >
          Sign in to inquire
        </ButtonLink>
      </Card>
    );
  }

  return (
    <>
      <Card className="space-y-3 p-5">
        <p className="bmpl-eyebrow">Inquire</p>
        <EnquiryForm listingId={listingId} slug={slug} />
      </Card>
      <Card className="space-y-3 p-5">
        <p className="bmpl-eyebrow">Book a viewing</p>
        <ViewingRequestForm listingId={listingId} slug={slug} />
      </Card>
    </>
  );
}
