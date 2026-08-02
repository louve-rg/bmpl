'use client';

import { useEffect } from 'react';
import { realEstateApi } from '../../lib/realestate';

/** Fires POST /property-seeker/recently-viewed/:id on mount. Fails silently for guests. */
export function RecentlyViewedTracker({ listingId }: { listingId: string }) {
  useEffect(() => {
    realEstateApi.seeker.recordView(listingId).catch(() => {
      /* guests / errors: nothing to do */
    });
  }, [listingId]);
  return null;
}
