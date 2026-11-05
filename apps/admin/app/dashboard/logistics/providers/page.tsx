'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Card, EmptyState, PageHeader, Spinner } from '../../../../components/ui';

/**
 * The carrier directory (BMPL-137, surfaced MDF-500).
 *
 * Each name links to `/dashboard/logistics/providers/:id` (MDF-524) for the
 * suspend/revoke, membership and in-flight-shipment controls -- still a
 * list with a member COUNT here, not the members themselves; that detail
 * page is where "manage this carrier's staff" actually lives, built against
 * Pam's carrier-lifecycle contract (see that page's own header comment for
 * exactly which parts of it are confirmed real vs. assumed ahead of her
 * branch landing). Reviewing/approving/rejecting a carrier's own
 * APPLICATION already works today through the existing, generic
 * Applications queue (`/dashboard/applications`) — nothing new needed there.
 */

interface Provider {
  id: string;
  businessName: string;
  description: string | null;
  contactEmail: string;
  contactPhone: string | null;
  district: string | null;
  city: string | null;
  addressLine1: string | null;
  operatingLicenceNumber: string | null;
  operatingLicenceExpiry: string | null;
  isActive: boolean;
  isTest: boolean;
  createdAt: string;
  activeMembers: number;
}

export default function CarrierProvidersPage() {
  const [providers, setProviders] = useState<Provider[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setProviders(await api.get<Provider[]>('/admin/logistics/providers'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load carriers.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Carriers')}
        title="Carriers"
        description="Organizations that may operate a line-haul leg. Assign one to a specific leg from that shipment's own page."
      />

      {err && <Alert tone="warning" className="mt-4">{err}</Alert>}

      {loading ? (
        <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : providers.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No carriers yet" description="A carrier appears here once a SHIPPING_PROVIDER application is approved." />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {providers.map((p) => (
            <Card key={p.id} className={`p-4 ${p.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/logistics/providers/${p.id}`}
                      className="break-words text-sm font-semibold text-belize-blue hover:underline"
                    >
                      {p.businessName}
                    </Link>
                    <Badge tone={p.isActive ? 'success' : 'neutral'}>{p.isActive ? 'Active' : 'Deactivated'}</Badge>
                    {p.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    {p.contactEmail}
                    {p.contactPhone ? ` · ${p.contactPhone}` : ''}
                    {[p.city, p.district?.replace(/_/g, ' ')].filter(Boolean).length > 0
                      ? ` · ${[p.city, p.district?.replace(/_/g, ' ')].filter(Boolean).join(', ')}`
                      : ''}
                  </p>
                  {p.operatingLicenceNumber && (
                    <p className="mt-0.5 text-xs text-[color:var(--bmpl-text-muted)]">
                      Licence {p.operatingLicenceNumber}
                      {p.operatingLicenceExpiry ? ` · expires ${new Date(p.operatingLicenceExpiry).toLocaleDateString()}` : ''}
                    </p>
                  )}
                </div>
                <p className="shrink-0 text-xs font-medium text-[color:var(--bmpl-text-muted)]">
                  {p.activeMembers} active member{p.activeMembers === 1 ? '' : 's'}
                </p>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
