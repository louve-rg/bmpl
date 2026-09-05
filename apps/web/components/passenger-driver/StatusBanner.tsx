'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { Alert, type Tone } from '../ui';

/**
 * Where the visitor's PASSENGER_DRIVER role currently stands. The status comes
 * from the same endpoint the My Roles page reads, and applying itself happens
 * THERE — the existing role-application machinery is reused, not rebuilt here.
 */
export function PassengerStatusBanner({ hasProfile, roleStatus }: { hasProfile: boolean; roleStatus: string | null }) {
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
    title = 'Approved passenger driver';
  } else if (roleStatus === 'PENDING') {
    tone = 'info';
    title = 'Application under review';
    body = <>Your Passenger Driver application is being reviewed. You can keep completing your profile and vehicles meanwhile.</>;
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
    title = 'Become a passenger driver';
    body = <>Complete the profile below, add a vehicle, then apply for the Passenger Driver role from {applyLink}.</>;
  } else {
    tone = 'info';
    title = 'Profile saved';
    body = <>Submit your Passenger Driver application from {applyLink} to get approved for departures.</>;
  }

  return (
    <Alert tone={tone} title={title}>
      {body}
    </Alert>
  );
}
