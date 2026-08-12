'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { api, type ApiError } from '../../lib/api';
import { Alert, Card as UiCard, Spinner, type Tone } from '../ui';
import type { DriverOperationsView } from '../dashboard/DriverOperations';

/* --------------------------------------------------------------- types */

export type ExpiryStatus = 'VALID' | 'EXPIRING_SOON' | 'EXPIRED' | null;

export interface Application {
  id: string;
  status: string;
  message: string | null;
  createdAt: string;
  reviewerNote: string | null;
}

export interface DriverProfile {
  id?: string;
  legalName: string;
  displayName: string;
  phone: string;
  homeDistrict: string;
  homeAddress?: string | null;
  emergencyContactName?: string | null;
  emergencyContactPhone?: string | null;
  licenceNumber: string;
  licenceExpiry: string | null;
  licenceExpiryStatus?: ExpiryStatus;
  vehicleOwnership: 'OWNED' | 'LEASED' | 'BORROWED' | 'NONE';
  availability: 'OFFLINE' | 'ONLINE' | 'UNAVAILABLE' | 'SUSPENDED';
  isActive?: boolean;
  ratingAverage?: number | null;
  completedDeliveries?: number;
  hasProfilePhoto?: boolean;
  /** Short-lived signed URL for the driver's own photo (private bucket). */
  profilePhotoUrl?: string | null;
  termsAccepted?: boolean;
  applicantNotes?: string | null;
}

export interface Vehicle {
  id: string;
  type: 'CAR' | 'MOTORCYCLE' | 'SCOOTER' | 'BICYCLE' | 'VAN' | 'TRUCK' | 'OTHER';
  make: string;
  model: string;
  year?: number | null;
  color?: string | null;
  licencePlate: string;
  registrationNumber?: string | null;
  registrationExpiry?: string | null;
  insuranceProvider?: string | null;
  insurancePolicyNumber?: string | null;
  insuranceExpiry?: string | null;
  photoUrls: string[];
  isPrimary: boolean;
  isActive: boolean;
  approvalStatus: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string | null;
  registrationExpiryStatus?: ExpiryStatus;
  insuranceExpiryStatus?: ExpiryStatus;
}

export interface ServiceArea {
  district: string;
  isActive: boolean;
}

export interface Eligibility {
  canGoOnline: boolean;
  reasons: string[];
}

export interface DashboardData {
  hasProfile: boolean;
  roleStatus: 'PENDING' | 'APPROVED' | 'SUSPENDED' | 'REVOKED' | 'REJECTED' | null;
  application: Application | null;
  profile: DriverProfile | null;
  vehicles: Vehicle[];
  serviceAreas: ServiceArea[];
  eligibility: Eligibility;
  /** Operations summary (M26.3). Absent for an applicant with no profile yet. */
  operations?: DriverOperationsView;
}

/* --------------------------------------------------------------- helpers */

export const DISTRICTS = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'];

export function districtLabel(d: string): string {
  return d
    .split('_')
    .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
    .join(' ');
}

export function errMessage(e: unknown): string {
  return (e as ApiError)?.message ?? 'Something went wrong.';
}

export function toDateInputValue(iso?: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

export function expiryTone(status?: string | null): Tone {
  switch (status) {
    case 'VALID':
      return 'success';
    case 'EXPIRING_SOON':
      return 'warning';
    case 'EXPIRED':
      return 'error';
    default:
      return 'neutral';
  }
}

/** Section card used across the driver pages. */
export function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <UiCard className="p-4 sm:p-6">
      <h2 className="bmpl-eyebrow mb-4">{title}</h2>
      {children}
    </UiCard>
  );
}

/* ------------------------------------------------------------- data hook */

/**
 * The driver dashboard payload, shared by every driver page.
 *
 * `/driver/dashboard` is one aggregate read that already returns profile,
 * vehicles, service areas, eligibility and operations together. Splitting the old
 * single mega-page into five routes therefore needed no new endpoints — each page
 * reads the same aggregate and renders the slice it owns. That keeps the pages in
 * agreement about eligibility (which several of them display) and means a change
 * saved on one page is reflected everywhere on the next load.
 */
export function useDriverDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      const d = await api.get<DashboardData>('/driver/dashboard');
      setData(d);
      setError(null);
    } catch (e) {
      setError(errMessage(e));
    }
  }, []);

  useEffect(() => {
    void reload().finally(() => setLoading(false));
  }, [reload]);

  return { data, loading, error, reload };
}

/**
 * Shell for a driver sub-page: handles loading, load failure, and the case where
 * the visitor has not started a driver profile yet.
 *
 * The last case matters: these routes are reachable by a PENDING applicant (a
 * document-problem notification deep-links straight here), and rendering an empty
 * form to someone who has no profile reads as a broken page.
 */
export function DriverPageShell({
  children,
  requiresProfile = true,
}: {
  children: (data: DashboardData, reload: () => Promise<void>) => ReactNode;
  /** Set false for pages that are useful before a profile exists. */
  requiresProfile?: boolean;
}) {
  const { data, loading, error, reload } = useDriverDashboard();

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (error) return <Alert tone="error">{error}</Alert>;
  if (!data) return <Alert tone="error">Your driver details could not be loaded.</Alert>;
  if (requiresProfile && !data.hasProfile) {
    return (
      <Alert tone="info" title="Start your driver application first">
        Create your driver profile from the{' '}
        <a className="font-semibold underline" href="/dashboard/driver">
          Driver Dashboard
        </a>{' '}
        to unlock this page.
      </Alert>
    );
  }
  return <>{children(data, reload)}</>;
}
