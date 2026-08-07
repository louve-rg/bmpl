'use client';

import Link from 'next/link';
import { money } from '../../lib/cart';
import { Alert, Badge, Button, Card, StatusBadge } from '../ui';

export interface DriverJobSummary {
  id: string;
  status: string;
  orderNumber: string;
  vendor: string;
  destination: string | null;
  estimateLabel: string | null;
  assignedAt: string | null;
  acceptedAt: string | null;
  offerExpiresAt: string | null;
}

export interface DriverOperationsView {
  availability: string;
  currentDelivery: DriverJobSummary | null;
  pendingOffer: DriverJobSummary | null;
  upcoming: DriverJobSummary[];
  counts: {
    activeNow: number;
    deliveredToday: number;
    deliveredThisWeek: number;
    completedAllTime: number;
  };
  earnings: { todayMinor: number; weekMinor: number; pendingPayoutMinor: number };
  performance: {
    ratingAverage: number | null;
    ratingCount: number;
    acceptanceRate: number | null;
    completionRate: number | null;
  };
  unreadNotifications: number;
}

/**
 * The driver's operations header (M26.3 · Part 5).
 *
 * Ordered by urgency, not by category: an outstanding offer has a countdown on
 * it and is worth money now, the job in progress is what they are doing, and the
 * numbers are context. A driver checking this at a kerbside should be able to
 * act on the top of the screen without reading the rest of it.
 *
 * Sits ABOVE the existing profile/vehicle forms rather than replacing them —
 * those already work, and a driver still needs them for licence and vehicle
 * upkeep.
 */
export function DriverOperations({ ops }: { ops: DriverOperationsView }) {
  return (
    <div className="space-y-4">
      {ops.pendingOffer && <OfferCard job={ops.pendingOffer} />}

      {ops.currentDelivery && (
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="bmpl-label">On this delivery now</p>
            <StatusBadge status={ops.currentDelivery.status} />
          </div>
          <JobLine job={ops.currentDelivery} />
          <Button
            // Full width on phones: this is tapped one-handed in a vehicle.
            className="mt-3 w-full sm:w-auto"
            type="button"
            onClick={() => {
              window.location.href = `/dashboard/driver/jobs/${ops.currentDelivery!.id}`;
            }}
          >
            Open delivery
          </Button>
        </Card>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Delivered today" value={String(ops.counts.deliveredToday)} />
        <Stat label="Earned today" value={money(ops.earnings.todayMinor)} />
        <Stat label="Last 7 days" value={`${ops.counts.deliveredThisWeek} · ${money(ops.earnings.weekMinor)}`} />
        <Stat
          label="Awaiting payout"
          value={money(ops.earnings.pendingPayoutMinor)}
          hint={ops.earnings.pendingPayoutMinor > 0 ? 'Paid out on settlement' : undefined}
        />
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat
          label="Rating"
          value={ops.performance.ratingAverage != null ? `★ ${ops.performance.ratingAverage.toFixed(1)}` : '—'}
          hint={ops.performance.ratingCount > 0 ? `${ops.performance.ratingCount} rating${ops.performance.ratingCount === 1 ? '' : 's'}` : 'No ratings yet'}
        />
        <Stat
          label="Acceptance"
          value={ops.performance.acceptanceRate != null ? `${ops.performance.acceptanceRate}%` : '—'}
        />
        <Stat
          label="Completion"
          value={ops.performance.completionRate != null ? `${ops.performance.completionRate}%` : '—'}
        />
        <Stat label="Completed all time" value={String(ops.counts.completedAllTime)} />
      </div>

      {ops.upcoming.length > 0 && (
        <Card className="p-4">
          <p className="bmpl-label">Also assigned to you</p>
          <ul className="mt-2 divide-y divide-slate-100">
            {ops.upcoming.map((job) => (
              <li key={job.id} className="py-2">
                <Link
                  href={`/dashboard/driver/jobs/${job.id}`}
                  className="block rounded-bmpl-md px-1 py-1 transition hover:bg-slate-50"
                >
                  <JobLine job={job} />
                </Link>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {ops.unreadNotifications > 0 && (
        <Link href="/dashboard/notifications" className="block">
          <Alert tone="info">
            You have {ops.unreadNotifications} unread notification
            {ops.unreadNotifications === 1 ? '' : 's'}.
          </Alert>
        </Link>
      )}
    </div>
  );
}

/** An offer awaiting accept/decline — the one thing on this page with a clock. */
function OfferCard({ job }: { job: DriverJobSummary }) {
  return (
    <Card className="border-belize-accent/40 bg-belize-accent/5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="bmpl-label">New delivery offer</p>
        <Badge tone="warning">Awaiting your response</Badge>
      </div>
      <JobLine job={job} />
      <p className="mt-2 text-xs text-slate-500">
        If you don’t respond, this offer passes to another driver.
      </p>
      <Link href={`/dashboard/driver/jobs/${job.id}`} className="mt-3 block">
        <Button type="button" className="w-full sm:w-auto">
          View and respond
        </Button>
      </Link>
    </Card>
  );
}

function JobLine({ job }: { job: DriverJobSummary }) {
  return (
    <div className="mt-1.5 min-w-0">
      <p className="truncate font-semibold text-belize-navy">
        {job.vendor} <span className="font-normal text-slate-400">·</span> {job.orderNumber}
      </p>
      <p className="truncate text-sm text-slate-500">
        {job.destination ?? 'Destination unavailable'}
        {job.estimateLabel ? ` · ${job.estimateLabel}` : ''}
      </p>
    </div>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card className="p-3">
      <p className="bmpl-label">{label}</p>
      {/* tabular-nums so figures don't jitter as they refresh. */}
      <p className="mt-1 text-lg font-bold tabular-nums text-belize-navy">{value}</p>
      {hint && <p className="mt-0.5 text-xs text-slate-400">{hint}</p>}
    </Card>
  );
}
