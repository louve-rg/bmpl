import { api } from './api';

/** "Notify me when back in stock" — customer subscriptions for an exact product/variant. */
export interface BackInStockKey {
  productId: string;
  variantId: string | null;
}

const variantQuery = (variantId?: string | null): string =>
  variantId ? `?variantId=${encodeURIComponent(variantId)}` : '';

export const backInStockApi = {
  ids: () => api.get<{ subscriptions: BackInStockKey[] }>('/back-in-stock/ids'),
  subscribe: (productId: string, variantId?: string | null) =>
    api.post<{ subscribed: true; productId: string; variantId: string | null }>(
      `/back-in-stock/${productId}${variantQuery(variantId)}`,
    ),
  unsubscribe: (productId: string, variantId?: string | null) =>
    api.del<{ subscribed: false }>(`/back-in-stock/${productId}${variantQuery(variantId)}`),
};

/** Is the exact (productId, variantId) currently subscribed? */
export function isSubscribed(
  subs: BackInStockKey[],
  productId: string,
  variantId: string | null,
): boolean {
  const target = variantId ?? null;
  return subs.some((s) => s.productId === productId && (s.variantId ?? null) === target);
}
