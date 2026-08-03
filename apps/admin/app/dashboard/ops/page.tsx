'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Alert, Button, Card, Field, PageHeader, Select, Spinner, Textarea } from '../../../components/ui';
import { adminCrumbs } from '../../../lib/admin-nav';

/* --------------------------------------------------------------- types */

interface Queues {
  pendingVendorApplications: number;
  pendingProductModeration: number;
  pendingDriverVehicles: number;
  pendingRoleApplications: number;
  moreInfoRoleApplications: number;
  openReviewReports: number;
  openSupportCases: number;
  failedSettlements: number;
  deliveriesPendingAssignment: number;
  awaitingPickupCollection: number;
  suspendedUsers: number;
  suspendedRoles: number;
}

type AnnouncementLevel = 'INFO' | 'WARNING' | 'CRITICAL';

interface PlatformSetting {
  id: string;
  announcementActive: boolean;
  announcementLevel: AnnouncementLevel;
  announcementMessage: string | null;
  maintenanceMode: boolean;
  maintenanceMessage: string | null;
  updatedById: string | null;
  updatedAt: string;
  createdAt: string;
}

interface Overview {
  queues: Queues;
  totalActionable: number;
  settings: PlatformSetting;
}

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

/* --------------------------------------------------------------- helpers */

const int = (n: number) => Math.trunc(n).toLocaleString('en-US');

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

function errMessage(err: unknown): string {
  return (err as ApiError)?.message ?? 'Something went wrong.';
}

/* Queue metadata: label + destination admin page, in display order. */
const QUEUE_META: Array<{ key: keyof Queues; label: string; href: string }> = [
  { key: 'pendingVendorApplications', label: 'Vendor applications', href: '/dashboard/vendors' },
  { key: 'pendingProductModeration', label: 'Products awaiting moderation', href: '/dashboard/products' },
  { key: 'pendingDriverVehicles', label: 'Driver vehicles to review', href: '/dashboard/drivers' },
  { key: 'pendingRoleApplications', label: 'Role applications', href: '/dashboard/applications' },
  { key: 'moreInfoRoleApplications', label: 'Applications needing more info', href: '/dashboard/applications' },
  { key: 'openReviewReports', label: 'Open review reports', href: '/dashboard/reviews' },
  { key: 'openSupportCases', label: 'Open support cases', href: '/dashboard/support' },
  { key: 'failedSettlements', label: 'Failed settlements', href: '/dashboard/settlements' },
  { key: 'deliveriesPendingAssignment', label: 'Deliveries pending assignment', href: '/dashboard/dispatch' },
  { key: 'awaitingPickupCollection', label: 'Awaiting pickup collection', href: '/dashboard/orders' },
  { key: 'suspendedUsers', label: 'Suspended users', href: '/dashboard/users?status=SUSPENDED' },
  { key: 'suspendedRoles', label: 'Suspended roles', href: '/dashboard/users?status=SUSPENDED' },
];

/* ----------------------------------------------------------------- page */

export default function OpsPage() {
  const [overview, setOverview] = useState<Overview | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      setState('loading');
      try {
        const ov = await api.get<Overview>('/admin/ops/overview');
        if (!active) return;
        setOverview(ov);
        setState('ready');
      } catch (err) {
        if (!active) return;
        setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        breadcrumbs={adminCrumbs('Operations')}
        eyebrow="Platform"
        title="Operations console"
        description="Action queues across the marketplace, the platform announcement banner and audit exports."
        actions={
          <a
            href="/api/admin/ops/audit.csv"
            download="audit-log.csv"
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 px-5 py-2.5 text-sm font-semibold text-belize-navy shadow-bmpl-sm transition hover:border-belize-blue hover:bg-belize-blue/5"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
              <path d="M12 3v12m0 0 4-4m-4 4-4-4M5 21h14" />
            </svg>
            Download audit log CSV
          </a>
        }
      />

      {state === 'forbidden' ? (
        <Alert tone="warning" title="Access restricted">
          You don&apos;t have the <code>ops.read</code> permission.
        </Alert>
      ) : state === 'loading' ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading operations…
        </div>
      ) : state === 'error' || !overview ? (
        <Alert tone="error">We couldn&apos;t load the operations console right now. Please try again shortly.</Alert>
      ) : (
        <>
          <QueuesSection queues={overview.queues} totalActionable={overview.totalActionable} />
          <SettingsSection initial={overview.settings} />
        </>
      )}
    </div>
  );
}

/* ------------------------------------------------------------ queues */

function QueuesSection({ queues, totalActionable }: { queues: Queues; totalActionable: number }) {
  const allClear = totalActionable === 0;

  return (
    <section aria-label="Action queues">
      <div
        className={`mb-4 rounded-bmpl-xl border p-5 ${
          allClear ? 'border-emerald-200 bg-emerald-50' : 'border-amber-300 bg-amber-50'
        }`}
      >
        <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Items needing attention</p>
        <p className={`mt-1 text-3xl font-bold ${allClear ? 'text-emerald-700' : 'text-amber-700'}`}>
          {allClear ? 'All clear' : `${int(totalActionable)} item${totalActionable === 1 ? '' : 's'} need attention`}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {QUEUE_META.map((q) => {
          const count = queues[q.key] ?? 0;
          const active = count > 0;
          return (
            <Link
              key={q.key}
              href={q.href}
              className={`group block rounded-bmpl-lg border p-4 shadow-bmpl-sm transition hover:shadow-bmpl-md ${
                active
                  ? 'border-amber-300 bg-amber-50 hover:border-amber-400'
                  : 'border-slate-200 bg-white hover:border-belize-blue'
              }`}
            >
              <p className={`text-2xl font-bold ${active ? 'text-amber-700' : 'text-belize-navy'}`}>{int(count)}</p>
              <p className="mt-1 text-xs font-medium text-slate-600">{q.label}</p>
            </Link>
          );
        })}
      </div>
    </section>
  );
}

/* ----------------------------------------------------------- settings */

const LEVEL_OPTIONS: Array<{ value: AnnouncementLevel; label: string }> = [
  { value: 'INFO', label: 'Info' },
  { value: 'WARNING', label: 'Warning' },
  { value: 'CRITICAL', label: 'Critical' },
];

const PREVIEW_STYLES: Record<AnnouncementLevel, string> = {
  INFO: 'bg-belize-blue text-white',
  WARNING: 'bg-amber-500 text-white',
  CRITICAL: 'bg-red-600 text-white',
};

function SettingsSection({ initial }: { initial: PlatformSetting }) {
  const [announcementActive, setAnnouncementActive] = useState(initial.announcementActive);
  const [announcementLevel, setAnnouncementLevel] = useState<AnnouncementLevel>(initial.announcementLevel);
  const [announcementMessage, setAnnouncementMessage] = useState(initial.announcementMessage ?? '');
  const [maintenanceMode, setMaintenanceMode] = useState(initial.maintenanceMode);
  const [maintenanceMessage, setMaintenanceMessage] = useState(initial.maintenanceMessage ?? '');

  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [readOnly, setReadOnly] = useState(false);

  const dirty = useMemo(
    () =>
      announcementActive !== initial.announcementActive ||
      announcementLevel !== initial.announcementLevel ||
      (announcementMessage.trim() || null) !== (initial.announcementMessage ?? null) ||
      maintenanceMode !== initial.maintenanceMode ||
      (maintenanceMessage.trim() || null) !== (initial.maintenanceMessage ?? null),
    [
      announcementActive,
      announcementLevel,
      announcementMessage,
      maintenanceMode,
      maintenanceMessage,
      initial,
    ],
  );

  async function submit() {
    setErr(null);
    setSaved(false);

    if (announcementActive && !announcementMessage.trim()) {
      setErr('An announcement message is required when the announcement is active.');
      return;
    }
    if (maintenanceMode && !maintenanceMessage.trim()) {
      setErr('A maintenance message is required when maintenance mode is on.');
      return;
    }

    const body = {
      announcementActive,
      announcementLevel,
      announcementMessage: announcementMessage.trim() ? announcementMessage.trim() : null,
      maintenanceMode,
      maintenanceMessage: maintenanceMessage.trim() ? maintenanceMessage.trim() : null,
    };

    setBusy(true);
    try {
      await api.patch<PlatformSetting>('/admin/ops/settings', body);
      setSaved(true);
    } catch (e) {
      if (apiStatus(e) === 403) {
        setReadOnly(true);
        return;
      }
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-label="Announcement and maintenance" className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-belize-navy">Announcement &amp; maintenance banner</h2>
        <p className="mt-1 text-xs text-slate-500">
          Display-only notice shown to users across the marketplace. This is informational — it does not disable the
          platform or block any functionality.
        </p>
      </div>

      {readOnly && (
        <Alert tone="warning" title="Editing needs ops.manage">
          You can view these settings but need the <code>ops.manage</code> permission to change them.
        </Alert>
      )}

      {saved && (
        <Alert tone="success" title="Settings saved">
          The announcement and maintenance settings have been updated.
        </Alert>
      )}

      <Card className="p-5">
        <fieldset disabled={readOnly || busy} className="space-y-6">
          {/* Announcement */}
          <div className="space-y-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={announcementActive}
                onChange={(e) => setAnnouncementActive(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue"
              />
              <span>
                <span className="text-sm font-semibold text-belize-navy">Show announcement banner</span>
                <span className="mt-0.5 block text-xs text-slate-500">Display a message at the top of the marketplace.</span>
              </span>
            </label>

            <div className="grid gap-4 sm:grid-cols-3">
              <Field label="Level" htmlFor="ann-level">
                <Select
                  id="ann-level"
                  value={announcementLevel}
                  onChange={(e) => setAnnouncementLevel(e.target.value as AnnouncementLevel)}
                >
                  {LEVEL_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="sm:col-span-2">
                <Field
                  label="Announcement message"
                  htmlFor="ann-message"
                  hint={`${announcementMessage.length}/500 characters`}
                >
                  <Textarea
                    id="ann-message"
                    rows={2}
                    maxLength={500}
                    value={announcementMessage}
                    onChange={(e) => setAnnouncementMessage(e.target.value)}
                    placeholder="e.g. Holiday hours: deliveries pause Sept 10."
                  />
                </Field>
              </div>
            </div>

            {announcementActive && announcementMessage.trim() && (
              <div>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">Preview</p>
                <div className={`flex items-start gap-3 rounded-bmpl-md px-4 py-2.5 text-sm font-medium ${PREVIEW_STYLES[announcementLevel]}`}>
                  <span className="inline-flex shrink-0 items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
                    {announcementLevel}
                  </span>
                  <span className="flex-1">{announcementMessage.trim()}</span>
                </div>
              </div>
            )}
          </div>

          <div className="border-t border-slate-200" />

          {/* Maintenance */}
          <div className="space-y-4">
            <label className="flex items-start gap-3">
              <input
                type="checkbox"
                checked={maintenanceMode}
                onChange={(e) => setMaintenanceMode(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-blue"
              />
              <span>
                <span className="text-sm font-semibold text-belize-navy">Show maintenance notice</span>
                <span className="mt-0.5 block text-xs text-slate-500">A distinct informational strip about planned maintenance.</span>
              </span>
            </label>

            <Field
              label="Maintenance message"
              htmlFor="maint-message"
              hint={`${maintenanceMessage.length}/500 characters`}
            >
              <Textarea
                id="maint-message"
                rows={2}
                maxLength={500}
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
                placeholder="e.g. Scheduled maintenance Sunday 2–4am."
              />
            </Field>
          </div>

          {err && <p className="text-sm font-medium text-red-600">{err}</p>}

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={submit} disabled={busy || readOnly || !dirty}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            {!readOnly && !dirty && !saved && <span className="text-xs text-slate-400">No changes to save.</span>}
          </div>
        </fieldset>
      </Card>
    </section>
  );
}
