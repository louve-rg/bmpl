'use client';

import { ReviewList } from './ReviewList';
import type { RatingAggregate } from '../../lib/reviews';

/** Thin wrapper: renders the public reviews section for a product. */
export function ProductReviews({
  productId,
  onAggregate,
}: {
  productId: string;
  onAggregate?: (aggregate: RatingAggregate) => void;
}) {
  return <ReviewList subjectType="PRODUCT" subjectId={productId} onAggregate={onAggregate} />;
}
