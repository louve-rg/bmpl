'use client';

import type { ReactNode } from 'react';
import { StarRating } from '../reviews/StarRating';
import { Alert, type Tone } from '../ui';
import { Card, type Application, type DashboardData, type DriverProfile } from './dashboard-data';

/** Where the driver's application/role currently stands. */
export function StatusBanner({
  hasProfile,
  roleStatus,
  application,
}: {
  hasProfile: boolean;
  roleStatus: DashboardData['roleStatus'];
  application: Application | null;
}) {
  let tone: Tone = 'info';
  let title = '';
  let body: ReactNode = null;

  if (roleStatus === 'APPROVED') {
    tone = 'success';
    title = 'Approved driver';
  } else if (roleStatus === 'PENDING') {
    tone = 'info';
    title = 'Application under review';
  } else if (roleStatus === 'SUSPENDED') {
    tone = 'error';
    title = 'Role suspended';
  } else if (roleStatus === 'REJECTED') {
    tone = 'error';
    title = 'Application rejected';
  } else if (roleStatus === 'REVOKED') {
    tone = 'error';
    title = 'Role revoked';
  } else if (!hasProfile) {
    tone = 'info';
    title = 'Become a delivery driver';
    body = 'Complete your profile and submit your application to start delivering.';
  } else {
    tone = 'info';
    title = 'Profile saved';
    body = 'Submit your driver application from My Roles to get approved for deliveries.';
  }

  return (
    <div className="space-y-3">
      <Alert tone={tone} title={title}>
        {body}
      </Alert>
      {application?.reviewerNote && (
        <Alert tone="info" title="Note from reviewer">
          {application.reviewerNote}
        </Alert>
      )}
    </div>
  );
}

/** The driver's rating and lifetime completion count. */
export function RatingSummary({ profile }: { profile: DriverProfile }) {
  const average = profile.ratingAverage ?? 0;
  const completed = profile.completedDeliveries ?? 0;
  return (
    <Card title="Your rating">
      <div className="flex flex-wrap items-center gap-6">
        <div className="flex flex-col">
          <span className="text-3xl font-bold text-belize-navy">{average > 0 ? average.toFixed(1) : '—'}</span>
          <StarRating value={average} size="md" className="mt-1" />
        </div>
        <div className="text-sm text-slate-500">
          <p>
            <span className="font-semibold text-belize-navy">{completed}</span> completed deliver{completed === 1 ? 'y' : 'ies'}
          </p>
          {average === 0 && <p className="mt-0.5 text-xs">No ratings yet — complete deliveries to start building your rating.</p>}
        </div>
      </div>
    </Card>
  );
}
