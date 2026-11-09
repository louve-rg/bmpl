'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { api, type ApiError } from '../../../../lib/api';
import { adminCrumbs } from '../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingRow, PageHeader } from '../../../../components/ui';

/**
 * TERM-4: the admin console half of TERM-3's backend (`apps/api/src/terminal/`,
 * merged `a80adf43`). Until this exists an admin cannot create a terminal
 * company, attach a hub, or invite an operator AT ALL — the owner's rule is
 * explicit that a feature living only in the backend is not a feature.
 *
 * Distinct from the existing "Terminals" link on this page (which opens
 * `/dashboard/logistics/hubs` — physical LogisticsHub rows). A terminal
 * COMPANY is the operator organization that staffs one or more of those
 * hubs; this page is named "Terminal companies" to keep the two apart.
 *
 * NOT YET BUILDABLE — no backend endpoint exists for these, confirmed by
 * reading apps/api/src/terminal/terminal.{controller,service}.ts and
 * packages/validation/src/terminal.ts end to end. Michael's ruling
 * (2026-11-09, TERM-4): these three are not equal.
 *   - Editing a company's own fields once created — no PATCH, no DELETE.
 *     THIS is the one that blocks reporting slice 1 complete: a company
 *     created with a wrong name or wrong isTest is permanently
 *     uncorrectable through the product. TERM-6 (Pam, queued behind
 *     TERM-5) adds it; this console is wired to it in a follow-up once
 *     that merges — no placeholder for it now.
 *   - Reactivating an ENDED membership, and changing an existing member's
 *     locations — "clunk, not blockage": ending a membership and sending
 *     a fresh invite genuinely does both today, with no DB access, at
 *     the cost of the operator's access until they re-accept. Does not
 *     block this card; also lands with TERM-6.
 * RULE FOR THIS CARD: no dead controls. Where a capability doesn't exist,
 * state the path that DOES work — never a disabled button with a tooltip.
 * Don't infer any of the three exist from this file.
 */

interface Company {
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string | null;
  isActive: boolean;
  isTest: boolean;
  createdAt: string;
}

export default function TerminalCompaniesPage() {
  const [companies, setCompanies] = useState<Company[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanManage((me.adminPermissions ?? []).includes('terminals.manage')))
      .catch(() => setCanManage(false));
  }, []);

  const load = useCallback(async () => {
    try {
      setCompanies(await api.get<Company[]>('/admin/terminal/companies'));
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not load terminal companies.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], 'Terminal companies')}
        title="Terminal companies"
        description="Organizations that staff a hub — attach their locations and invite their managers/operators here. Physical hubs themselves live under Terminals."
      />

      {err && <Alert tone="warning" className="mt-4">{err}</Alert>}

      {canManage && <CreateCompanyCard onCreated={load} />}

      {companies === null ? (
        <LoadingRow className="mt-6" />
      ) : companies.length === 0 ? (
        <div className="mt-6">
          <EmptyState title="No terminal companies yet" description="Create one above to start attaching hub locations and inviting staff." />
        </div>
      ) : (
        <div className="mt-4 space-y-3">
          {companies.map((c) => (
            <Card key={c.id} className={`p-4 ${c.isActive ? '' : 'opacity-60'}`}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/dashboard/logistics/terminal-companies/${c.id}`}
                      className="break-words text-sm font-semibold text-belize-blue hover:underline"
                    >
                      {c.businessName}
                    </Link>
                    <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Deactivated'}</Badge>
                    {c.isTest && <Badge tone="neutral">Simulation</Badge>}
                  </div>
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    {c.contactEmail}
                    {c.contactPhone ? ` · ${c.contactPhone}` : ''}
                  </p>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateCompanyCard({ onCreated }: { onCreated: () => void }) {
  const [businessName, setBusinessName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [isTest, setIsTest] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function create() {
    if (!businessName.trim() || !contactEmail.trim()) {
      setErr('A business name and contact email are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.post('/admin/terminal/companies', {
        businessName: businessName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
        isTest,
      });
      setBusinessName('');
      setContactEmail('');
      setContactPhone('');
      setIsTest(false);
      onCreated();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not create this terminal company.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mt-4 p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">New terminal company</h3>
      {err && <Alert tone="warning" className="mt-2">{err}</Alert>}
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Field label="Business name" htmlFor="tc-name">
          <Input id="tc-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} placeholder="e.g. Belize Terminal Services" />
        </Field>
        <Field label="Contact email" htmlFor="tc-email">
          <Input id="tc-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="ops@company.bz" />
        </Field>
        <Field label="Contact phone (optional)" htmlFor="tc-phone">
          <Input id="tc-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+501-…" />
        </Field>
      </div>
      <label className="mt-3 flex items-center gap-2 text-sm text-[color:var(--bmpl-text-muted)]">
        <input type="checkbox" checked={isTest} onChange={(e) => setIsTest(e.target.checked)} className="accent-belize-blue" />
        Simulation company (isTest) — never mixed with real hubs or real staff
      </label>
      <div className="mt-3">
        <Button type="button" disabled={busy} onClick={() => void create()}>
          {busy ? 'Creating…' : 'Create terminal company'}
        </Button>
      </div>
    </Card>
  );
}
