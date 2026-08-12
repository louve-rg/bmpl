'use client';

import { Alert, Badge, ButtonLink, PageHeader, StatusBadge } from '../../../../components/ui';
import { DriverBreadcrumb } from '../../../../components/driver/DriverBreadcrumb';
import {
  Card,
  DriverPageShell,
  expiryTone,
  type DashboardData,
  type ExpiryStatus,
} from '../../../../components/driver/dashboard-data';

function formatDate(iso?: string | null): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

/**
 * Application & Documents.
 *
 * The destination for a document-problem or application-decision notification,
 * and the answer to "why can't I go online?" when the cause is paperwork. It
 * READS the document state that already exists on the driver dashboard payload —
 * licence expiry, per-vehicle registration and insurance expiry, application
 * status and reviewer note — and hands off to My Roles for the uploads
 * themselves, which is where the role-application flow owns them.
 *
 * Reachable before approval (`requiresProfile={false}`): a PENDING applicant is
 * exactly who gets sent here, and telling them to come back once they are
 * approved would be circular.
 */
export default function DriverDocumentsPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <DriverBreadcrumb current="Application & Documents" />
      <PageHeader
        title="Application & Documents"
        description="Your driver application, and the documents that keep you eligible to work."
      />
      <DriverPageShell requiresProfile={false}>{(data) => <DocumentsView data={data} />}</DriverPageShell>
    </div>
  );
}

function DocumentsView({ data }: { data: DashboardData }) {
  const expiring = documentIssues(data);

  return (
    <div className="space-y-5">
      {expiring.length > 0 && (
        <Alert tone="warning" title="These documents need attention">
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {expiring.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        </Alert>
      )}

      <Card title="Application">
        {data.application ? (
          <div className="space-y-2 text-sm">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-slate-500">Status:</span>
              <StatusBadge status={data.application.status} />
              <span className="text-xs text-slate-400">Submitted {formatDate(data.application.createdAt)}</span>
            </div>
            {data.application.message && <p className="break-words text-slate-600">{data.application.message}</p>}
            {data.application.reviewerNote && (
              <Alert tone="info" title="Note from reviewer">
                {data.application.reviewerNote}
              </Alert>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-500">You haven’t submitted a driver application yet.</p>
        )}
        <div className="mt-4">
          <ButtonLink href="/dashboard/roles" variant="outline" size="sm">
            Manage application &amp; uploads
          </ButtonLink>
        </div>
      </Card>

      <Card title="Your documents">
        <p className="mb-3 text-sm text-slate-500">
          Required documents — ID, driver&rsquo;s licence, vehicle registration, insurance, and vehicle &amp; profile
          photos — are uploaded as part of your role application.
        </p>
        <ul className="divide-y divide-slate-100 text-sm">
          <DocumentRow
            label="Driver’s licence"
            detail={data.profile?.licenceNumber ? `No. ${data.profile.licenceNumber}` : 'Not on file'}
            expiry={data.profile?.licenceExpiry}
            status={data.profile?.licenceExpiryStatus ?? null}
          />
          <DocumentRow
            label="Profile photo"
            detail={data.profile?.hasProfilePhoto ? 'On file' : 'Not uploaded'}
            expiry={null}
            status={data.profile?.hasProfilePhoto ? 'VALID' : null}
          />
          {data.vehicles.map((v) => (
            <li key={v.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <b className="text-belize-navy">
                  {v.make} {v.model}
                </b>
                <span className="text-xs text-slate-400">{v.licencePlate}</span>
                <StatusBadge status={v.approvalStatus} />
              </div>
              {v.rejectionReason && <p className="mt-1 break-words text-xs text-red-600">Reason: {v.rejectionReason}</p>}
              <div className="mt-2 space-y-1.5 pl-1">
                <ExpiryLine label="Registration" expiry={v.registrationExpiry} status={v.registrationExpiryStatus ?? null} />
                <ExpiryLine label="Insurance" expiry={v.insuranceExpiry} status={v.insuranceExpiryStatus ?? null} />
              </div>
            </li>
          ))}
          {data.vehicles.length === 0 && (
            <li className="py-3 text-slate-500">
              No vehicle documents yet —{' '}
              <a className="font-semibold text-belize-blue hover:underline" href="/dashboard/driver/vehicles">
                add a vehicle
              </a>
              .
            </li>
          )}
        </ul>
      </Card>
    </div>
  );
}

function DocumentRow({
  label,
  detail,
  expiry,
  status,
}: {
  label: string;
  detail: string;
  expiry?: string | null;
  status: ExpiryStatus;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 py-3">
      <span className="min-w-0">
        <span className="block font-semibold text-belize-navy">{label}</span>
        <span className="block break-words text-xs text-slate-500">{detail}</span>
      </span>
      <span className="flex items-center gap-2">
        {expiry && <span className="text-xs text-slate-400">Expires {formatDate(expiry)}</span>}
        {status && <Badge tone={expiryTone(status)}>{status.replace('_', ' ')}</Badge>}
      </span>
    </li>
  );
}

function ExpiryLine({ label, expiry, status }: { label: string; expiry?: string | null; status: ExpiryStatus }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs">
      <span className="text-slate-500">{label}:</span>
      <span className="text-slate-400">{formatDate(expiry)}</span>
      {status ? <Badge tone={expiryTone(status)}>{status.replace('_', ' ')}</Badge> : <Badge tone="neutral">Not provided</Badge>}
    </div>
  );
}

/** Documents that are expired or about to be — the same facts the server uses for eligibility. */
function documentIssues(data: DashboardData): string[] {
  const issues: string[] = [];
  const flag = (label: string, status: ExpiryStatus) => {
    if (status === 'EXPIRED') issues.push(`${label} has expired.`);
    else if (status === 'EXPIRING_SOON') issues.push(`${label} expires soon.`);
  };
  flag('Your driver’s licence', data.profile?.licenceExpiryStatus ?? null);
  for (const v of data.vehicles) {
    flag(`Registration for your ${v.make} ${v.model}`, v.registrationExpiryStatus ?? null);
    flag(`Insurance for your ${v.make} ${v.model}`, v.insuranceExpiryStatus ?? null);
  }
  return issues;
}
