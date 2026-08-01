'use client';

import { useEffect } from 'react';
import { savedApi } from '../../lib/saved';

/**
 * Renders nothing. On mount, fire-and-forget records that the current viewer
 * looked at this product. Guests (401) and non-viewable products (404) are
 * swallowed silently — they simply aren't recorded.
 */
export function RecordView({ productId }: { productId: string }) {
  useEffect(() => {
    savedApi.recordView(productId).catch(() => {
      /* guests / unavailable products are not recorded */
    });
  }, [productId]);

  return null;
}
