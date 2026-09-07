'use client';

import { useCallback, useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import type { ApplicableRole, MeView } from '../../../lib/types';
import { verifyEmailFirst, verifyEmailFirstMessage } from '../../../lib/role-gate';
import { VerifyEmailBanner } from '../../../components/VerifyEmailBanner';
import { Alert, Button, Card, Label, PageHeader, Spinner, StatusBadge, Textarea } from '../../../components/ui';

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

/**
 * Upload one file to the role-application private bucket; returns the storage key.
 *
 * Sends the bytes to the API through the same-origin `/api` proxy. The previous
 * flow (presign → browser PUT straight to the storage endpoint) is cross-origin and
 * the bucket has no CORS policy for the custom domain, so the PUT was blocked and
 * surfaced as "Failed to fetch". Mirrors the product-image upload transport.
 */
async function uploadDoc(roleCode: string, file: File): Promise<string> {
  const { key } = await api.upload<{ key: string }>(
    `/roles/applications/${roleCode}/documents/upload?filename=${encodeURIComponent(file.name)}`,
    file,
  );
  return key;
}

export default function RolesPage() {
  const [roles, setRoles] = useState<ApplicableRole[]>([]);
  const [apps, setApps] = useState<RoleApplication[]>([]);
  const [me, setMe] = useState<MeView | null>(null);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [r, a, m] = await Promise.all([
        api.get<ApplicableRole[]>('/roles/applicable'),
        api.get<RoleApplication[]>('/roles/applications'),
        // Whether the email is verified decides, per role, if Apply can
        // succeed at all — fetched here so the person learns that BEFORE
        // filling anything in, not from the refusal after.
        api.get<MeView>('/me'),
      ]);
      setRoles(r);
      setApps(a);
      setMe(m);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="My Roles"
        description="Request the provider roles you need. Each is reviewed independently — you keep your Customer account."
      />

      {message && (
        <Alert tone={message.kind === 'ok' ? 'brand' : 'error'} className="mb-5">
          {message.text}
        </Alert>
      )}

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading roles…
        </div>
      ) : (
        <>
          {/* The way OUT of the gate, on the page where the gate bites: the
              banner carries the resend action the per-card messages point at.
              A verified person never sees it. */}
          {me && !me.emailVerified && roles.some((r) => verifyEmailFirst(r, me.emailVerified)) && (
            <VerifyEmailBanner email={me.email} />
          )}
          <div className="grid gap-4 sm:grid-cols-2">
            {roles.map((role) => (
              <RoleCard
                key={role.roleCode}
                role={role}
                emailVerified={me ? me.emailVerified : null}
                onDone={(m) => { setMessage(m); void load(); }}
              />
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

function RoleCard({
  role,
  emailVerified,
  onDone,
}: {
  role: ApplicableRole;
  /** null while /me is unknown — an unknown state never pre-blocks. */
  emailVerified: boolean | null;
  onDone: (m: { kind: 'ok' | 'err'; text: string }) => void;
}) {
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
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <h3 className="font-bold text-belize-navy">{role.label}</h3>
        {role.status && <StatusBadge status={role.status} className="shrink-0" />}
      </div>
      <p className="mt-2 text-sm text-slate-600">{role.description}</p>
      {needsDocs && <p className="mt-3 text-xs text-slate-500">Documents required: {role.requiredDocuments.join(', ')}</p>}

      <div className="mt-4">
        {!role.canApply ? (
          <span className="text-sm text-slate-400">{role.status === 'APPROVED' ? 'Active' : 'In progress'}</span>
        ) : verifyEmailFirst(role, emailVerified) ? (
          // The reason in place of the action (the fare-gate pattern): a live
          // Apply control here leads to a certain refusal at submit. The
          // server still enforces this independently — see the catch below.
          <p className="text-sm font-medium text-amber-700">{verifyEmailFirstMessage(role.label)}</p>
        ) : !role.requiresApproval ? (
          <Button size="sm" disabled={busy} onClick={applyNoDocs}>{busy ? 'Activating…' : 'Activate'}</Button>
        ) : !open ? (
          <Button size="sm" onClick={() => setOpen(true)}>Apply</Button>
        ) : (
          <div className="space-y-3">
            {role.requiredDocuments.map((d) => (
              <div key={d}>
                <Label className="mb-1 normal-case tracking-normal">{d}</Label>
                <input
                  type="file"
                  accept="application/pdf,image/jpeg,image/png,image/webp"
                  onChange={(e) => setFiles((s) => ({ ...s, [d]: e.target.files?.[0] ?? null }))}
                  className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue"
                />
              </div>
            ))}
            <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything to add for the reviewer? (optional)" rows={2} />
            {err && <p className="text-xs font-medium text-red-600" role="alert">{err}</p>}
            <div className="flex gap-2">
              <Button size="sm" disabled={busy} onClick={submit}>{busy ? 'Submitting…' : 'Submit application'}</Button>
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
          </div>
        )}
      </div>
    </Card>
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
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="font-semibold text-belize-navy">{app.roleCode.replace(/_/g, ' ')} application</span>
        <StatusBadge status={app.status} />
      </div>
      <p className="mt-1 text-xs text-slate-400">
        Submitted {new Date(app.createdAt).toLocaleDateString()} · {app.documents.length} document{app.documents.length === 1 ? '' : 's'}
      </p>
      {latestReview?.note && (
        <Alert tone={app.status === 'REJECTED' ? 'error' : 'info'} className="mt-2">
          <span className="font-medium">Reviewer:</span> {latestReview.note}
        </Alert>
      )}

      {app.status === 'MORE_INFO_REQUIRED' && (
        <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
          <p className="text-xs font-medium text-slate-600">Respond with the requested information:</p>
          <Textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder="Your response to the reviewer" rows={2} />
          <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" onChange={(e) => setFile(e.target.files?.[0] ?? null)} className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue" />
          {err && <p className="text-xs font-medium text-red-600" role="alert">{err}</p>}
          <Button size="sm" disabled={busy || !note.trim()} onClick={resubmit}>{busy ? 'Submitting…' : 'Submit response'}</Button>
        </div>
      )}
    </Card>
  );
}
