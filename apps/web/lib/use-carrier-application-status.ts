'use client';

import { useEffect, useState } from 'react';
import { api } from './api';
import type { ProviderStatus, ShippingProviderProfile } from './shipping-provider';

/**
 * Whether the signed-in user has started a carrier (SHIPPING_PROVIDER)
 * organization profile, and at what status — independent of whether the
 * SHIPPING_PROVIDER role itself has been approved (two separate lifecycles,
 * see shipping-provider.ts's own doc comments). Exists only so the nav
 * (DashboardNavList) can surface a first-time applicant's own pending
 * application (MDF-526); every carrier page itself uses `useCarrier()`, not
 * this.
 *
 * Fetched once per mount, same as `useUnreadMessages` fires unconditionally
 * for every signed-in user — `GET /shipping/provider/profile` answers `null`
 * for the overwhelming majority who never started one. Best-effort: a failed
 * fetch leaves the nav exactly as it was (null), same as having no profile —
 * a missing nav entry is a smaller problem than an error banner in the
 * sidebar.
 */
export function useCarrierApplicationStatus(): ProviderStatus | null {
  const [status, setStatus] = useState<ProviderStatus | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ShippingProviderProfile | null>('/shipping/provider/profile')
      .then((profile) => {
        if (!cancelled) setStatus(profile?.status ?? null);
      })
      .catch(() => {
        /* silent — best-effort, see doc comment above */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return status;
}
