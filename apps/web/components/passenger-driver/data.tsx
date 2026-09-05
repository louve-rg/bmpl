'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { api } from '../../lib/api';
import type { ApplicableRole } from '../../lib/types';
import type { PassengerDriverProfile, PassengerEligibility, PassengerVehicle } from '../../lib/passenger-driver';
import { Alert, Spinner } from '../ui';

/* ------------------------------------------------------------- data hook */

export interface PassengerDriverData {
  profile: PassengerDriverProfile | null;
  eligibility: PassengerEligibility;
  vehicles: PassengerVehicle[];
  /** PASSENGER_DRIVER role status from the roles surface; null = never applied. */
  roleStatus: string | null;
}

/**
 * The passenger-driver pages' shared read. Unlike the delivery driver there is
 * no aggregate endpoint — profile, eligibility and vehicles are separate
 * CUSTOMER-gated reads (an applicant builds all three before approval), so they
 * are fetched together here to keep every page agreeing about eligibility.
 * Role status rides along from the same endpoint the My Roles page uses.
 */
export function usePassengerDriver() {
  const [data, setData] = useState<PassengerDriverData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const [profile, eligibility, vehicles, applicable] = await Promise.all([
        api.get<PassengerDriverProfile | null>('/passenger/driver/profile'),
        api.get<PassengerEligibility>('/passenger/driver/eligibility'),
        api.get<PassengerVehicle[]>('/passenger/driver/vehicles'),
        api.get<ApplicableRole[]>('/roles/applicable'),
      ]);
      setData({
        profile,
        eligibility,
        vehicles,
        roleStatus: applicable.find((r) => r.roleCode === 'PASSENGER_DRIVER')?.status ?? null,
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

/**
 * Shell for a passenger-driver sub-page: loading, load failure, and the
 * visitor who has not started a passenger-driver profile yet — these routes
 * stay reachable by URL for applicants, and an empty form with no explanation
 * reads as a broken page.
 */
export function PassengerDriverShell({
  children,
  requiresProfile = true,
}: {
  children: (data: PassengerDriverData, reload: () => Promise<void>) => ReactNode;
  /** Set false for pages that are useful before a profile exists. */
  requiresProfile?: boolean;
}) {
  const { data, loading, error, reload } = usePassengerDriver();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Alert tone="error">Your passenger-driver details could not be loaded.</Alert>;
  if (requiresProfile && !data.profile) {
    return (
      <Alert tone="info" title="Start your passenger-driver profile first">
        Create your profile from the{' '}
        <Link className="font-semibold underline" href="/dashboard/passenger-driver">
          Passenger Dashboard
        </Link>{' '}
        to unlock this page.
      </Alert>
    );
  }
  return <>{children(data, reload)}</>;
}

/* ------------------------------------------------------------ breadcrumb */

/** "Passenger Dashboard → {page}" on every passenger-driver sub-page. */
export function PassengerDriverBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        <li>
          <Link
            href="/dashboard/passenger-driver"
            className="font-medium text-belize-blue transition hover:text-belize-deep hover:underline"
          >
            Passenger Dashboard
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
