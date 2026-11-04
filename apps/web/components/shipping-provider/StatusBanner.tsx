'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { api, type ApiError } from '../../lib/api';
import type { ShippingProviderProfile } from '../../lib/shipping-provider';
import { orgStatusView } from '../../lib/shipping-provider';
import { Alert, Button, type Tone } from '../ui';

/**
 * Where the visitor's generic SHIPPING_PROVIDER ROLE stands. Status comes
 * from the endpoint the My Roles page reads, and applying happens THERE —
 * the existing role-application machinery is reused, not rebuilt here
 * (mirrors `passenger-operator/StatusBanner.tsx` exactly; see
 * `OrgStatusCard` below for the SEPARATE, carrier-specific status this
 * banner does not cover).
 */
export function RoleStatusBanner({ hasProfile, roleStatus }: { hasProfile: boolean; roleStatus: string | null }) {
  let tone: Tone = 'info';
  let title = '';
  let body: ReactNode = null;

  const applyLink = (
    <Link href="/dashboard/roles" className="font-semibold underline">
      My Roles
    </Link>
  );

  if (roleStatus === 'APPROVED') {
    tone = 'success';
    title = 'Approved shipping provider role';
  } else if (roleStatus === 'PENDING') {
    tone = 'info';
    title = 'Role application under review';
    body = <>Your Shipping Provider role application is being reviewed. You can keep completing your organization profile meanwhile.</>;
  } else if (roleStatus === 'SUSPENDED') {
    tone = 'error';
    title = 'Role suspended';
  } else if (roleStatus === 'REJECTED') {
    tone = 'error';
    title = 'Role application rejected';
    body = <>See the reviewer&rsquo;s note in {applyLink}.</>;
  } else if (roleStatus === 'REVOKED') {
    tone = 'error';
    title = 'Role revoked';
  } else if (!hasProfile) {
    tone = 'info';
    title = 'Operate shipping on BML';
    body = <>Complete the organization profile below, then apply for the Shipping Provider role from {applyLink}.</>;
  } else {
    tone = 'info';
    title = 'Profile saved';
    body = <>Apply for the Shipping Provider role from {applyLink} to work legs and routes.</>;
  }

  return (
    <Alert tone={tone} title={title}>
      {body}
    </Alert>
  );
}

/**
 * Where the carrier ORGANIZATION itself stands — `ShippingProviderProfile.
 * status`, a SEPARATE lifecycle from the generic role above (D1b: "two
 * independent sources of truth, never derived from each other"). Operating
 * requires BOTH the role APPROVED (banner above) AND this status APPROVED
 * (`providerEligibilityReasons`'s AND-gate). Shown as its own card so the
 * two never get collapsed into one status the way a single badge would —
 * an administrator can suspend/revoke the ORGANIZATION independently of the
 * person's own role standing.
 *
 * Resubmit is the carrier's ONE self-service transition (D5): REJECTED ->
 * PENDING only, never reachable from SUSPENDED or REVOKED — there is no
 * edge in the shared transition table for either, enforced server-side, so
 * this button simply does not render for those statuses rather than
 * rendering and being refused.
 */
export function OrgStatusCard({ profile, onChanged }: { profile: ShippingProviderProfile; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const view = orgStatusView(profile.status);

  async function resubmit() {
    setBusy(true);
    setErr(null);
    try {
      await api.post('/shipping/provider/profile/resubmit', {});
      await onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not resubmit the application.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Alert tone={view.tone} title={`Organization status: ${view.title}`}>
      <p>{view.body}</p>
      {profile.statusReason && (
        <p className="mt-1">
          <strong>Reason given:</strong> {profile.statusReason}
        </p>
      )}
      {err && <p className="mt-1 font-medium">{err}</p>}
      {profile.status === 'REJECTED' && profile.canResubmit && (
        <Button type="button" size="sm" className="mt-2" disabled={busy} onClick={() => void resubmit()}>
          {busy ? 'Resubmitting…' : 'Resubmit for review'}
        </Button>
      )}
    </Alert>
  );
}
