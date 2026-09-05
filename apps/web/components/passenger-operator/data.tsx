'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../lib/api';
import type { ApplicableRole } from '../../lib/types';
import type { OperatorProfile } from '../../lib/passenger-operator';
import { Alert, Spinner } from '../ui';

/* ------------------------------------------------------------- data hook */

export interface OperatorData {
  profile: OperatorProfile | null;
  /** PASSENGER_PROVIDER role status from the roles surface; null = never applied. */
  roleStatus: string | null;
}

/**
 * The operator pages' shared read: the business profile (CUSTOMER-gated, so an
 * applicant builds it before approval) plus role status from the endpoint the
 * My Roles page uses. Routes, departures and bookings are NOT here — those
 * endpoints require the APPROVED role, and each operational page loads its own
 * slice and explains its own 403.
 */
export function useOperator() {
  const [data, setData] = useState<OperatorData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [profile, applicable] = await Promise.all([
        api.get<OperatorProfile | null>('/passenger/provider/profile'),
        api.get<ApplicableRole[]>('/roles/applicable'),
      ]);
      setData({
        profile,
        roleStatus: applicable.find((r) => r.roleCode === 'PASSENGER_PROVIDER')?.status ?? null,
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

/** Loading/failure/no-profile shell for operator sub-pages reachable by URL. */
export function OperatorShell({
  children,
  requiresProfile = true,
}: {
  children: (data: OperatorData, reload: () => Promise<void>) => ReactNode;
  requiresProfile?: boolean;
}) {
  const { data, loading, error, reload } = useOperator();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Alert tone="error">Your operator details could not be loaded.</Alert>;
  if (requiresProfile && !data.profile) {
    return (
      <Alert tone="info" title="Start your operator profile first">
        Create your business profile from the{' '}
        <Link className="font-semibold underline" href="/dashboard/passenger-operator">
          Operator Dashboard
        </Link>{' '}
        to unlock this page.
      </Alert>
    );
  }
  return <>{children(data, reload)}</>;
}

/**
 * Shown where an operational endpoint answered 403: those routes require the
 * PASSENGER_PROVIDER role to be APPROVED (publishing a transport service is
 * operational, unlike building the application profile), so the requirement is
 * explained rather than rendered as a broken page.
 */
export function ApprovalRequired() {
  return (
    <Alert tone="info" title="Approval required">
      This page works once your Passenger-Service Provider application is approved. You can check its status in{' '}
      <Link className="font-semibold underline" href="/dashboard/roles">
        My Roles
      </Link>
      .
    </Alert>
  );
}

/* ------------------------------------------------------------ breadcrumb */

/** "Operator Dashboard → {page}" on every operator sub-page. */
export function OperatorBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        <li>
          <Link
            href="/dashboard/passenger-operator"
            className="font-medium text-belize-blue transition hover:text-belize-deep hover:underline"
          >
            Operator Dashboard
          </Link>
        </li>
        <li aria-hidden className="text-slate-300">
          /
        </li>
        <li aria-current="page" className="min-w-0 truncate font-medium text-slate-600">
          {current}
        </li>
      </ol>
    </nav>
  );
}
