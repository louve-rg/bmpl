'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../lib/api';
import { ProductRow, type ProductCardData } from './ProductCard';

interface ForYouResponse {
  personalized: boolean;
  items: ProductCardData[];
}

/**
 * Personalized recommendations. Requires a signed-in customer; on 401 (guests)
 * it renders nothing. The heading reflects whether the feed is personalized.
 */
export function ForYou({ className = '' }: { className?: string }) {
  const [data, setData] = useState<ForYouResponse | null>(null);

  useEffect(() => {
    let active = true;
    api
      .get<ForYouResponse>('/recommendations/for-you')
      .then((d) => active && setData(d))
      .catch((_err: ApiError) => {
        // 401 (guest) or any error: stay silent.
        if (active) setData(null);
      });
    return () => {
      active = false;
    };
  }, []);

  if (!data || !data.items || data.items.length === 0) return null;

  return (
    <div className={className}>
      <ProductRow title={data.personalized ? 'Recommended for you' : 'Popular picks'} items={data.items} />
    </div>
  );
}
