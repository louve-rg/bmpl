'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, type Tone } from '../ui';

/**
 * Where the visitor's PASSENGER_PROVIDER role stands. Status comes from the
 * endpoint the My Roles page reads, and applying happens THERE — the existing
 * role-application machinery is reused, not rebuilt here.
 */
export function OperatorStatusBanner({ hasProfile, roleStatus }: { hasProfile: boolean; roleStatus: string | null }) {
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
    title = 'Approved passenger-service provider';
  } else if (roleStatus === 'PENDING') {
    tone = 'info';
    title = 'Application under review';
    body = <>Your Passenger-Service Provider application is being reviewed. You can keep completing your business profile and fleet meanwhile.</>;
  } else if (roleStatus === 'SUSPENDED') {
    tone = 'error';
    title = 'Role suspended';
  } else if (roleStatus === 'REJECTED') {
    tone = 'error';
    title = 'Application rejected';
    body = <>See the reviewer&rsquo;s note in {applyLink}.</>;
  } else if (roleStatus === 'REVOKED') {
    tone = 'error';
    title = 'Role revoked';
  } else if (!hasProfile) {
    tone = 'info';
    title = 'Operate passenger transport on BML';
    body = <>Complete the business profile below, then apply for the Passenger-Service Provider role from {applyLink}.</>;
  } else {
    tone = 'info';
    title = 'Profile saved';
    body = <>Submit your Passenger-Service Provider application from {applyLink} to publish routes and departures.</>;
  }

  return (
    <Alert tone={tone} title={title}>
      {body}
    </Alert>
  );
}
