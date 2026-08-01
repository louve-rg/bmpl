'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { ProductRow, type ProductCardData } from './ProductCard';

interface RelatedResponse {
  related: ProductCardData[];
  moreFromVendor: ProductCardData[];
}

/**
 * Product-detail cross-sell. Fetches the public related feed for a slug and
 * renders "You may also like" and "More from {vendor}" rows. Empty rows are
 * hidden; a failed fetch renders nothing.
 */
export function RelatedProducts({ slug, vendorName }: { slug: string; vendorName?: string }) {
  const [data, setData] = useState<RelatedResponse | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<RelatedResponse>(`/marketplace/products/${encodeURIComponent(slug)}/related`)
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));
    return () => {
      active = false;
    };
  }, [slug]);

  if (!data) return null;
  const related = data.related ?? [];
  const moreFromVendor = data.moreFromVendor ?? [];
  if (related.length === 0 && moreFromVendor.length === 0) return null;

  return (
    <div className="mt-14 space-y-12">
      <ProductRow title="You may also like" items={related} />
      <ProductRow title={vendorName ? `More from ${vendorName}` : 'More from this store'} items={moreFromVendor} />
    </div>
  );
}
