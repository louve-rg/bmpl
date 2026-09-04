/**
 * Pure display and gating rules for the dispatch console, moved verbatim out of
 * app/dashboard/dispatch/[id]/page.tsx so they can be unit tested — a Next.js
 * page module may not export anything besides its page fields.
 */

export interface PostalAddress {
  fullName: string | null;
  phone: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  city: string | null;
  district: string | null;
}

/** The vehicle actually on the job, which the API sends alongside the driver. */
export interface AssignedVehicle {
  type: string | null;
  make: string | null;
  model: string | null;
  color: string | null;
  licencePlate: string | null;
}

const ASSIGNED_STATUSES = new Set(['ASSIGNED', 'DRIVER_ACCEPTED', 'DRIVER_DECLINED']);

export function money(n: number | null | undefined): string {
  return n == null ? '—' : `$${(n / 100).toFixed(2)}`;
}

/** Street lines only — city and district get their own rows. */
export function addressLines(a: PostalAddress | null): string {
  if (!a) return '—';
  const parts = [a.addressLine1, a.addressLine2].filter(Boolean);
  return parts.length > 0 ? parts.join(', ') : '—';
}

export function vehicleSummary(v: AssignedVehicle | null): string {
  if (!v) return '—';
  const parts = [v.color, v.make, v.model].filter(Boolean).join(' ');
  const plate = v.licencePlate ? ` · ${v.licencePlate}` : '';
  return `${parts || v.type || 'Vehicle'}${plate}`;
}

/** An operator may hand-assign only a delivery nothing has been done with yet. */
export function canAssign(status: string): boolean {
  return status === 'PENDING_ASSIGNMENT';
}

/** Reassignment (and cancellation) stop the moment the parcel is picked up. */
export function canReassign(status: string): boolean {
  return ASSIGNED_STATUSES.has(status);
}

/** Least busy first; a driver whose load is unknown sorts as if idle. */
export function byFewestActiveJobs(a: { activeJobs: number | null }, b: { activeJobs: number | null }): number {
  return (a.activeJobs ?? 0) - (b.activeJobs ?? 0);
}
