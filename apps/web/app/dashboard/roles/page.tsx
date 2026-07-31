'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import type { ApplicableRole } from '../../../lib/types';
import { Button } from '../../../components/ui';

interface AppReview {
  action: string;
  note: string | null;
  fromStatus: string | null;
  toStatus: string | null;
  createdAt: string;
}
interface RoleApplication {
  id: string;
  roleCode: string;
  status: string;
  message: string | null;
  createdAt: string;
  documents: Array<{ id: string; label: string | null; uploadedAt: string }>;
  reviews: AppReview[];
}

const STATUS_STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  MORE_INFO_REQUIRED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  REVOKED: 'bg-slate-200 text-slate-700',
  WITHDRAWN: 'bg-slate-200 text-slate-700',
};

/** Upload one file to the role-application private bucket; returns the storage key. */
async function uploadDoc(roleCode: string, file: File): Promise<string> {
  const presign = await api.post<{ uploadUrl: string; key: string }>(
    `/roles/applications/${roleCode}/documents/presign`,
    { fileName: file.name, contentType: file.type || 'application/octet-stream', sizeBytes: file.size },
  );
  const put = await fetch(presign.uploadUrl, { method: 'PUT', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
  if (!put.ok) throw new Error('Upload failed. Please try again.');
  return presign.key;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<ApplicableRole[]>([]);
  const [apps, setApps] = useState<RoleApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a] = await Promise.all([
        api.get<ApplicableRole[]>('/roles/applicable'),
        api.get<RoleApplication[]>('/roles/applications'),
      ]);
      setRoles(r);
      setApps(a);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-6">
        <h1 className="text-2xl font-bold text-belize-navy">My Roles</h1>
        <p className="mt-1 text-sm text-slate-600">
          Request the provider roles you need. Each is reviewed independently — you keep your Customer account.
        </p>
      </header>

      {message && (
        <div role="status" className={`mb-5 rounded-xl border px-4 py-3 text-sm ${message.kind === 'ok' ? 'border-belize-light bg-belize-blue/5 text-belize-navy' : 'border-red-200 bg-red-50 text-red-700'}`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <p className="text-sm text-slate-500">Loading roles…</p>
      ) : (
        <>
          <div className="grid gap-4 sm:grid-cols-2">
            {roles.map((role) => (
              <RoleCard key={role.roleCode} role={role} onDone={(m) => { setMessage(m); void load(); }} />
            ))}
          </div>

          {apps.length > 0 && (
            <section className="mt-10">
              <h2 className="mb-3 text-lg font-semibold text-belize-navy">My applications</h2>
              <div className="space-y-3">
                {apps.map((app) => (
                  <ApplicationCard key={app.id} app={app} onDone={(m) => { setMessage(m); void load(); }} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function RoleCard({ role, onDone }: { role: ApplicableRole; onDone: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [files, setFiles] = useState<Record<string, File | null>>({});
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const needsDocs = role.requiredDocuments.length > 0;

  async function submit() {
    setErr(null);
    if (needsDocs && role.requiredDocuments.some((d) => !files[d])) {
      setErr('Please attach every required document.');
      return;
    }
    setBusy(true);
    try {
      const keys: string[] = [];
      for (const d of role.requiredDocuments) {
        const f = files[d];
        if (f) keys.push(await uploadDoc(role.roleCode, f));
      }
      await api.post('/roles/applications', { roleCode: role.roleCode, documentKeys: keys, message: note.trim() || undefined });
      onDone({ kind: 'ok', text: role.requiresApproval ? `Your ${role.label} application was submitted for review.` : `The ${role.label} role was activated.` });
    } catch (e) {
      setErr((e as ApiError).message ?? 'Unable to submit application.');
    } finally {
      setBusy(false);
    }
  }

  async function applyNoDocs() {
    setBusy(true);
    try {
      await api.post('/roles/applications', { roleCode: role.roleCode, documentKeys: [] });
      onDone({ kind: 'ok', text: role.requiresApproval ? `Your ${role.label} application was submitted for review.` : `The ${role.label} role was activated.` });
    } catch (e) {
      onDone({ kind: 'err', text: (e as ApiError).message ?? 'Unable to submit application.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="rounded-2xl border border-slate-200 bg-white p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-belize-navy">{role.label}</h3>
        {role.status && (
          <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[role.status] ?? 'bg-slate-100 text-slate-600'}`}>
            {role.status.replace(/_/g, ' ')}
          </span>
        )}
      </div>
      <p className="mt-2 text-sm text-slate-600">{role.description}</p>
      {needsDocs && <p className="mt-3 text-xs text-slate-500">Documents required: {role.requiredDocuments.join(', ')}</p>}

      <div className="mt-4">
        {!role.canApply ? (
          <span className="text-sm text-slate-400">{role.status === 'APPROVED' ? 'Active' : 'In progress'}</span>
        ) : !role.requiresApproval ? (
          <Button size="sm" disabled={busy} onClick={applyNoDocs}>{busy ? 'Activating…' : 'Activate'}</Button>
        ) : !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>Apply</Button>
        ) : (
          <div className="space-y-3">
            {role.requiredDocuments.map((d) => (
              <div key={d}>
                <label className="mb-1 block text-xs font-medium text-slate-600">{d}</label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFiles((s) => ({ ...s, [d]: e.target.files?.[0] ?? null }))}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
                />
              </div>
            ))}
            <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add for the reviewer? (optional)" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            {err && <p className="text-xs text-red-600">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit application'}</Button>
              <button type="button" onClick={() => setOpen(false)} className="text-sm text-slate-500 hover:text-slate-700">Cancel</button>
            </div>
          </div>
        )}
      </div>
    </article>
  );
}

function ApplicationCard({ app, onDone }: { app: RoleApplication; onDone: (m: { kind: 'ok' | 'err'; text: string }) => void }) {
  const [busy, setBusy] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [note, setNote] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const latestReview = [...app.reviews].reverse().find((r) => r.note);

  async function resubmit() {
    setErr(null);
    setBusy(true);
    try {
      const keys: string[] = [];
      if (file) keys.push(await uploadDoc(app.roleCode, file));
      await api.post(`/roles/applications/${app.id}/more-info`, { message: note.trim(), documentKeys: keys });
      onDone({ kind: 'ok', text: 'Your response was submitted for review.' });
    } catch (e) {
      setErr((e as ApiError).message ?? 'Unable to submit response.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-belize-navy">{app.roleCode.replace(/_/g, ' ')} application</span>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-semibold ${STATUS_STYLES[app.status] ?? 'bg-slate-100 text-slate-600'}`}>{app.status.replace(/_/g, ' ')}</span>
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Submitted {new Date(app.createdAt).toLocaleDateString()} · {app.documents.length} document{app.documents.length === 1 ? '' : 's'}
      </p>
      {latestReview?.note && (
        <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${app.status === 'REJECTED' ? 'bg-red-50 text-red-700' : 'bg-blue-50 text-blue-700'}`}>
          <span className="font-medium">Reviewer:</span> {latestReview.note}
        </p>
      )}

      {app.status === 'MORE_INFO_REQUIRED' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600">Respond with the requested information:</p>
          <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your response to the reviewer" rows={2} className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue" />
          {err && <p className="text-xs text-red-600">{err}</p>}
          <Button size="sm" disabled={busy || !note.trim()} onClick={resubmit}>{busy ? 'Submitting…' : 'Submit response'}</Button>
        </div>
      )}
    </div>
  );
}
