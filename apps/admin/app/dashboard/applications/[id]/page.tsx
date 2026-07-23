import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ROLE_DEFINITIONS, type RoleCode } from '@bmpl/shared';
import { serverGet } from '../../../../lib/server-api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { ReviewActions } from './ReviewActions';
import { DocumentLink } from './DocumentLink';

export const dynamic = 'force-dynamic';

interface Review {
  id: string;
  action: string;
  note: string | null;
  createdAt: string;
  fromStatus: string | null;
  toStatus: string | null;
  reviewer: { id: string; firstName: string; lastName: string } | null;
}
interface ApplicationDetail {
  id: string;
  roleCode: RoleCode;
  status: string;
  message: string | null;
  submittedAt: string;
  user: { id: string; email: string; firstName: string; lastName: string; district: string | null };
  documents: Array<{ id: string; label: string | null; contentType: string }>;
  reviews: Review[];
}

export default async function ApplicationDetailPage({ params }: { params: { id: string } }) {
  const res = await serverGet<ApplicationDetail>(`/admin/applications/${params.id}`);
  if (!res.ok) notFound();
  const app = res.data;
  const decided = !['PENDING', 'MORE_INFO_REQUIRED'].includes(app.status);

  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/dashboard/applications" className="text-sm text-belize-blue hover:underline">
        ← Back to queue
      </Link>

      <header className="mt-3 mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-belize-navy">
            {ROLE_DEFINITIONS[app.roleCode].label} application
          </h1>
          <p className="text-sm text-slate-500">
            {app.user.firstName} {app.user.lastName} · {app.user.email}
          </p>
        </div>
        <StatusBadge status={app.status} />
      </header>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Applicant message</h2>
        <p className="text-sm text-slate-700">{app.message || <em className="text-slate-400">No message provided.</em>}</p>
        <p className="mt-3 text-xs text-slate-500">
          District: {app.user.district ?? '—'} · Submitted {new Date(app.submittedAt).toLocaleString()}
        </p>
      </section>

      <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">Documents</h2>
        {app.documents.length === 0 ? (
          <p className="text-sm text-slate-400">No documents uploaded.</p>
        ) : (
          <div className="flex flex-wrap gap-2">
            {app.documents.map((doc) => (
              <DocumentLink
                key={doc.id}
                documentId={doc.id}
                label={doc.label ?? doc.contentType ?? 'Document'}
              />
            ))}
          </div>
        )}
      </section>

      <section className="mb-5">
        <ReviewActions applicationId={app.id} decided={decided} />
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold uppercase text-slate-500">Review history</h2>
        <ol className="space-y-3">
          {app.reviews.map((r) => (
            <li key={r.id} className="border-l-2 border-belize-light pl-3">
              <p className="text-sm font-medium text-belize-navy">
                {r.action.replace(/_/g, ' ')}
                {r.reviewer && (
                  <span className="font-normal text-slate-500">
                    {' '}
                    by {r.reviewer.firstName} {r.reviewer.lastName}
                  </span>
                )}
              </p>
              {r.note && <p className="text-sm text-slate-600">{r.note}</p>}
              <p className="text-xs text-slate-400">{new Date(r.createdAt).toLocaleString()}</p>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
