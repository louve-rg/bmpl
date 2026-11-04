'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import type { ApplicableRole } from '../../lib/types';
import type { ShippingProviderProfile } from '../../lib/shipping-provider';
import { Alert, Spinner } from '../ui';

/* ------------------------------------------------------------- data hook */

export interface CarrierData {
  profile: ShippingProviderProfile | null;
  /** SHIPPING_PROVIDER role status from the roles surface; null = never applied. Independent of `profile.status` — see OrgStatusCard's own doc comment for why both exist. */
  roleStatus: string | null;
}

/**
 * The carrier pages' shared read: the organization profile (CUSTOMER-gated,
 * so an applicant builds it before either approval) plus the generic role
 * status from the endpoint the My Roles page uses. Legs and routes are NOT
 * here — those endpoints require the APPROVED SHIPPING_PROVIDER role, and
 * each operational page loads its own slice and explains its own 403 (same
 * convention as the passenger-operator pages this mirrors).
 */
export function useCarrier() {
  const [data, setData] = useState<CarrierData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [profile, applicable] = await Promise.all([
        api.get<ShippingProviderProfile | null>('/shipping/provider/profile'),
        api.get<ApplicableRole[]>('/roles/applicable'),
      ]);
      setData({
        profile,
        roleStatus: applicable.find((r) => r.roleCode === 'SHIPPING_PROVIDER')?.status ?? null,
      });
      setError(null);
    } catch (e) {
      setError((e as { message?: string })?.message ?? 'Something went wrong.');
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  return { data, loading, error, reload };
}

/* ----------------------------------------------------------------- shell */

/** Loading/failure/no-profile shell for carrier sub-pages reachable by URL. */
export function CarrierShell({
  children,
  requiresProfile = true,
}: {
  children: (data: CarrierData, reload: () => Promise<void>) => ReactNode;
  requiresProfile?: boolean;
}) {
  const { data, loading, error, reload } = useCarrier();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Alert tone="error">Your carrier details could not be loaded.</Alert>;
  if (requiresProfile && !data.profile) {
    return (
      <Alert tone="info" title="Start your organization profile first">
        Create your organization profile from the{' '}
        <Link className="font-semibold underline" href="/dashboard/shipping-provider">
          Carrier Dashboard
        </Link>{' '}
        to unlock this page.
      </Alert>
    );
  }
  return <>{children(data, reload)}</>;
}

/**
 * Shown where an operational endpoint answered 403: those routes require
 * BOTH the SHIPPING_PROVIDER role to be APPROVED and the organization's own
 * status to be APPROVED (two independent checks — see OrgStatusCard), so
 * the requirement is explained rather than rendered as a broken page.
 */
export function ApprovalRequired() {
  return (
    <Alert tone="info" title="Approval required">
      This page works once your Shipping Provider role is approved and your organization's own status is approved.
      Check the role in{' '}
      <Link className="font-semibold underline" href="/dashboard/roles">
        My Roles
      </Link>{' '}
      and the organization status on the{' '}
      <Link className="font-semibold underline" href="/dashboard/shipping-provider">
        Carrier Dashboard
      </Link>
      .
    </Alert>
  );
}

/* ------------------------------------------------------------ breadcrumb */

/** "Carrier Dashboard → {page}" on every carrier sub-page. */
export function CarrierBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        <li>
          <Link
            href="/dashboard/shipping-provider"
            className="font-medium text-[color:var(--bmpl-link)] transition hover:text-belize-deep hover:underline"
          >
            Carrier Dashboard
          </Link>
        </li>
        <li aria-hidden className="text-slate-300">
          /
        </li>
        <li aria-current="page" className="min-w-0 truncate font-medium text-[color:var(--bmpl-text)]">
          {current}
        </li>
      </ol>
    </nav>
  );
}
