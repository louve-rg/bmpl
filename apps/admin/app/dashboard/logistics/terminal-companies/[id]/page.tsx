'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { adminCrumbs } from '../../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingRow, PageHeader, Select, Spinner } from '../../../../../components/ui';

/**
 * TERM-4, closed out by TERM-6-UI. Contract read from
 * apps/api/src/terminal/{terminal.controller.ts,terminal.service.ts} and
 * packages/validation/src/terminal.ts on origin/main plus Pam's TERM-6 PR
 * #629 diff (bb112650), not re-derived. TERM-6 closed all three gaps TERM-4
 * named: editing a company's own details (PATCH companies/:id), directly
 * reactivating an ended member (POST members/:userId/reactivate), and
 * granting/revoking ONE location for an already-ACTIVE member (POST/DELETE
 * members/:userId/locations(/:locationId)) — slice 1 is complete.
 *
 * Still deliberately absent, and still a "no dead controls" case rather
 * than an oversight: an ACTIVE member's own ROLE cannot be changed in
 * place — reactivateMember and grantMemberLocation both touch only status/
 * endedAt or one location grant, never memberRole, so a role change still
 * has exactly one working path, end-and-reinvite, and the ACTIVE member
 * row says so rather than offering a role control that doesn't exist.
 *
 * Two backend facts this page must never contradict (terminal.service.ts):
 *   - No implicit whole-company grant, not even for MANAGER — a member with
 *     zero active locations sees nothing. `inviteTerminalCompanyMemberSchema`
 *     (packages/validation/src/terminal.ts:30) requires `locationIds.min(1)`
 *     server-side; the invite form below enforces the same before it ever
 *     reaches that validator, not instead of it.
 *   - A deactivated location's access is re-checked at READ time
 *     (terminal.service.ts myWorkspace: "Re-checked here, not just at grant
 *     time"), not cleaned up in a pass. `getCompany` returns each member's
 *     location grants verbatim, including ones whose location has since been
 *     deactivated — this page cross-references every member location against
 *     the company's own `locations[].isActive` (the authoritative flag) on
 *     every render rather than trusting a cached grant list, so a location
 *     deactivated a moment ago never reads as still-granted here.
 *
 * Absent vs. broken vs. no-permission, three different states that must
 * read differently (Michael's standing rule, named explicitly for this
 * card): a company with no locations yet (LocationsCard "none yet" empty
 * state), a company whose locations have all been deactivated (a distinct
 * warning, not the same empty state), and a 403 on the company read itself
 * (surfaced as the server's own permission message, never silently treated
 * as "not found").
 */

type MemberRole = 'MANAGER' | 'OPERATOR';

interface CompanyLocation {
  id: string;
  isActive: boolean;
  hub: { id: string; code: string; name: string; district?: string; city?: string };
}

interface CompanyMember {
  id: string;
  userId: string;
  name: string;
  email: string;
  memberRole: MemberRole;
  status: 'ACTIVE' | 'ENDED';
  createdAt: string;
  endedAt: string | null;
  locations: Array<{ id: string; hub: { id: string; code: string; name: string } }>;
}

interface CompanyInvite {
  id: string;
  email: string;
  memberRole: MemberRole;
  expiresAt: string;
  createdAt: string;
  locationCount: number;
}

interface CompanyDetail {
  id: string;
  businessName: string;
  contactEmail: string;
  contactPhone: string | null;
  isActive: boolean;
  isTest: boolean;
  createdAt: string;
  locations: CompanyLocation[];
  members: CompanyMember[];
  pendingInvites: CompanyInvite[];
}

interface Hub {
  id: string;
  code: string;
  name: string;
  district: string;
  city: string;
  isActive: boolean;
  isTest?: boolean;
}

const when = (iso: string | null | undefined) => (iso ? new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' }) : null);

export default function TerminalCompanyDetailPage() {
  const params = useParams<{ id: string }>();
  const id = decodeURIComponent(String(params.id ?? ''));

  const [company, setCompany] = useState<CompanyDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [canManage, setCanManage] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => setCanManage((me.adminPermissions ?? []).includes('terminals.manage')))
      .catch(() => setCanManage(false));
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setCompany(await api.get<CompanyDetail>(`/admin/terminal/companies/${id}`));
      setErr(null);
      setNotFound(false);
    } catch (e) {
      const ex = e as ApiError;
      if (ex.status === 404) {
        setNotFound(true);
      } else {
        // Includes a 403 — the server's own permission message is shown
        // verbatim, same convention as the carrier console, and is never
        // mistaken here for "this company does not exist."
        setErr(ex.message ?? 'Could not load this terminal company.');
      }
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading) {
    return (
      <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  if (err) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Terminal companies', '/dashboard/logistics/terminal-companies'], 'Terminal company')} title="Terminal company" />
        <Alert tone="warning" className="mt-4">{err}</Alert>
      </div>
    );
  }

  if (notFound || !company) {
    return (
      <div>
        <PageHeader breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Terminal companies', '/dashboard/logistics/terminal-companies'], 'Terminal company')} title="Terminal company" />
        <div className="mt-6">
          <EmptyState title="Terminal company not found" description="This company may have been removed, or the id is wrong." />
        </div>
      </div>
    );
  }

  const activeLocationIds = new Set(company.locations.filter((l) => l.isActive).map((l) => l.id));

  return (
    <div className="space-y-6">
      <PageHeader
        breadcrumbs={adminCrumbs(['Logistics', '/dashboard/logistics'], ['Terminal companies', '/dashboard/logistics/terminal-companies'], company.businessName)}
        title={company.businessName}
        description={company.contactEmail}
      />

      <ProfileCard company={company} canManage={canManage} onChanged={load} />
      <LocationsCard company={company} canManage={canManage} onChanged={load} />
      <MembersCard company={company} activeLocationIds={activeLocationIds} canManage={canManage} onChanged={load} />
      <InvitesCard company={company} activeLocationIds={activeLocationIds} canManage={canManage} onChanged={load} />
    </div>
  );
}

/**
 * TERM-6: `isTest` is never offered here, editable or not — it's excluded
 * from `updateTerminalCompanySchema` entirely (the simulation boundary is
 * fixed at creation, see that schema's own comment), not just unchecked by
 * this form.
 */
function ProfileCard({ company: c, canManage, onChanged }: { company: CompanyDetail; canManage: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [businessName, setBusinessName] = useState(c.businessName);
  const [contactEmail, setContactEmail] = useState(c.contactEmail);
  const [contactPhone, setContactPhone] = useState(c.contactPhone ?? '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function startEdit() {
    setBusinessName(c.businessName);
    setContactEmail(c.contactEmail);
    setContactPhone(c.contactPhone ?? '');
    setErr(null);
    setEditing(true);
  }

  async function save() {
    if (!businessName.trim() || !contactEmail.trim()) {
      setErr('A business name and contact email are required.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      await api.patch(`/admin/terminal/companies/${c.id}`, {
        businessName: businessName.trim(),
        contactEmail: contactEmail.trim(),
        contactPhone: contactPhone.trim() || undefined,
      });
      setEditing(false);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not update this company.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Profile</h3>
        <div className="flex items-center gap-2">
          <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Deactivated'}</Badge>
          {c.isTest && <Badge tone="neutral">Simulation</Badge>}
          {canManage && !editing && (
            <Button type="button" variant="ghost" size="sm" onClick={startEdit}>
              Edit
            </Button>
          )}
        </div>
      </div>

      {err && <Alert tone="warning" className="mt-2">{err}</Alert>}

      {editing ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <Field label="Business name" htmlFor="tc-edit-name">
            <Input id="tc-edit-name" value={businessName} onChange={(e) => setBusinessName(e.target.value)} />
          </Field>
          <Field label="Contact email" htmlFor="tc-edit-email">
            <Input id="tc-edit-email" type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} />
          </Field>
          <Field label="Contact phone (optional)" htmlFor="tc-edit-phone">
            <Input id="tc-edit-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} />
          </Field>
          <div className="flex gap-2 sm:col-span-3">
            <Button type="button" disabled={busy} onClick={() => void save()}>
              {busy ? 'Saving…' : 'Save'}
            </Button>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
          <Row label="Contact" value={`${c.contactEmail}${c.contactPhone ? ` · ${c.contactPhone}` : ''}`} />
          <Row label="Created" value={when(c.createdAt) ?? '—'} />
        </dl>
      )}
    </Card>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">{label}</dt>
      <dd className="mt-0.5 text-[color:var(--bmpl-text)]">{value}</dd>
    </div>
  );
}

/**
 * Absent ("no locations yet") and broken ("every location has been
 * deactivated") read as two different messages, not the same empty state —
 * the owner's standing rule, named explicitly for this card.
 */
function LocationsCard({ company, canManage, onChanged }: { company: CompanyDetail; canManage: boolean; onChanged: () => void }) {
  const [hubs, setHubs] = useState<Hub[] | null>(null);
  const [hubId, setHubId] = useState('');
  const [addBusy, setAddBusy] = useState(false);
  const [removeBusy, setRemoveBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Hub[]>('/admin/logistics/hubs')
      .then(setHubs)
      .catch(() => setHubs([]));
  }, []);

  const activeLocationHubIds = useMemo(() => new Set(company.locations.filter((l) => l.isActive).map((l) => l.hub.id)), [company.locations]);
  // A hub already an ACTIVE location of this company is excluded (adding it
  // again would just be removeLocation's own reactivation path, offered
  // more directly by removing-then-not, i.e. there is nothing new to add);
  // a hub whose location row here was deactivated stays offered, because
  // picking it again is exactly how terminal.service.ts addLocation
  // reactivates that same row rather than creating a second one.
  const availableHubs = (hubs ?? []).filter((h) => h.isTest === company.isTest && !activeLocationHubIds.has(h.id));

  async function addLocation() {
    if (!hubId) return;
    setAddBusy(true);
    setErr(null);
    try {
      await api.post(`/admin/terminal/companies/${company.id}/locations`, { hubId });
      setHubId('');
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not attach that hub.');
    } finally {
      setAddBusy(false);
    }
  }

  async function removeLocation(locationId: string) {
    setRemoveBusy(locationId);
    setErr(null);
    try {
      await api.del(`/admin/terminal/companies/${company.id}/locations/${locationId}`);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not remove that location.');
    } finally {
      setRemoveBusy(null);
    }
  }

  const activeCount = company.locations.filter((l) => l.isActive).length;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Locations</h3>
      {err && <Alert tone="warning" className="mt-2">{err}</Alert>}

      {company.locations.length === 0 && (
        <div className="mt-3">
          <EmptyState title="No locations yet" description="Attach a hub below to let this company's staff work there." />
        </div>
      )}

      {company.locations.length > 0 && activeCount === 0 && (
        <Alert tone="warning" className="mt-3">
          Every location this company had has been deactivated. No member of this company can access any location
          right now — not because none were ever set up, but because all of them have since been turned off.
        </Alert>
      )}

      {company.locations.length > 0 && (
        <ul className="mt-3 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {company.locations.map((l) => (
            <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-belize-navy">{l.hub.name}</span>{' '}
                <span className="text-xs text-slate-500">
                  {l.hub.code}
                  {l.hub.city ? ` · ${l.hub.city}` : ''}
                </span>{' '}
                <Badge tone={l.isActive ? 'success' : 'neutral'}>{l.isActive ? 'Active' : 'Deactivated'}</Badge>
              </div>
              {canManage && l.isActive && (
                <Button variant="ghost" size="sm" disabled={removeBusy === l.id} onClick={() => void removeLocation(l.id)}>
                  {removeBusy === l.id ? 'Removing…' : 'Remove'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canManage && (
        <div className="mt-3">
          <Field label="Attach a hub" htmlFor="tc-add-hub">
            <div className="flex gap-2">
              <Select id="tc-add-hub" value={hubId} onChange={(e) => setHubId(e.target.value)} className="flex-1">
                <option value="">— select a hub —</option>
                {availableHubs.map((h) => (
                  <option key={h.id} value={h.id}>
                    {h.name} ({h.code})
                  </option>
                ))}
              </Select>
              <Button type="button" variant="outline" disabled={!hubId || addBusy} onClick={() => void addLocation()}>
                {addBusy ? 'Attaching…' : 'Attach'}
              </Button>
            </div>
          </Field>
          {hubs !== null && availableHubs.length === 0 && (
            <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
              No {company.isTest ? 'simulation' : 'real'} hubs are available to attach — every matching hub is already an active location here.
            </p>
          )}
        </div>
      )}
    </Card>
  );
}

const MEMBER_ROLES: MemberRole[] = ['MANAGER', 'OPERATOR'];

/**
 * Member roster, invite form and end control. A member's OWN location
 * grants are cross-referenced against `activeLocationIds` (derived from the
 * company's own `locations[].isActive`, the authoritative flag) rather than
 * trusted as returned — a location deactivated after the grant was made
 * must stop reading as access here on the very next load, with no separate
 * cleanup step.
 */
/**
 * What the API now tells us about the invitation email itself. The endpoint
 * used to return 201 whether Resend accepted the message or threw, so an
 * administrator had no way to tell a sent invitation from a lost one. The
 * invite row is still created either way — a provider outage must not cost us
 * the invitation — so a failure here means "resend", never "start again".
 */
type InviteDelivery = { delivered: boolean; outcome: string };

function deliveryMessage(d: InviteDelivery): { tone: 'success' | 'warning'; text: string } {
  if (d.delivered) {
    return d.outcome === 'simulated'
      ? { tone: 'warning', text: 'Invitation created. Email was SIMULATED by this environment, not actually delivered.' }
      : { tone: 'success', text: 'Invitation created and the email was accepted by the provider.' };
  }
  const why =
    d.outcome === 'missing_credential'
      ? 'the email provider is not configured in this environment'
      : d.outcome === 'provider_error'
        ? 'the email provider rejected or failed the send'
        : d.outcome === 'not_implemented'
          ? 'no email transport is enabled here'
          : d.outcome;
  return {
    tone: 'warning',
    text: `Invitation created but the email was NOT delivered — ${why}. The invite is still valid: use Resend below. The link cannot be recovered any other way.`,
  };
}

function MembersCard({
  company,
  activeLocationIds,
  canManage,
  onChanged,
}: {
  company: CompanyDetail;
  activeLocationIds: Set<string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [email, setEmail] = useState('');
  const [memberRole, setMemberRole] = useState<MemberRole>('OPERATOR');
  const [pickedLocations, setPickedLocations] = useState<Set<string>>(new Set());
  const [inviteBusy, setInviteBusy] = useState(false);
  const [endBusy, setEndBusy] = useState<string | null>(null);
  const [reactivateBusy, setReactivateBusy] = useState<string | null>(null);
  // Keyed `${userId}:${locationId}` for a revoke, `${userId}:grant` for a grant.
  const [locationActionBusy, setLocationActionBusy] = useState<string | null>(null);
  const [grantPick, setGrantPick] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<InviteDelivery | null>(null);

  const activeLocations = company.locations.filter((l) => l.isActive);

  function togglePicked(id: string) {
    setPickedLocations((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function invite() {
    if (!email.trim()) {
      setErr('An email address is required.');
      return;
    }
    if (pickedLocations.size === 0) {
      // Mirrors inviteTerminalCompanyMemberSchema's own locationIds.min(1) --
      // enforced here BEFORE the request, not instead of the server's own
      // check, so the reason a company-wide-by-default invite can't be sent
      // is visible before a round trip, not just after one.
      setErr('Select at least one location — there is no whole-company grant.');
      return;
    }
    setInviteBusy(true);
    setErr(null);
    setDelivery(null);
    try {
      const created = await api.post<{ delivery?: InviteDelivery }>(
        `/admin/terminal/companies/${company.id}/invites`,
        {
          email: email.trim(),
          memberRole,
          locationIds: Array.from(pickedLocations),
        },
      );
      // The send outcome, not just the 201. An older API that does not report
      // it leaves this null rather than claiming a delivery it never proved.
      if (created?.delivery) setDelivery(created.delivery);
      setEmail('');
      setMemberRole('OPERATOR');
      setPickedLocations(new Set());
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not send that invite.');
    } finally {
      setInviteBusy(false);
    }
  }

  async function endMember(userId: string) {
    setEndBusy(userId);
    setErr(null);
    try {
      await api.del(`/admin/terminal/companies/${company.id}/members/${userId}`);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not end that membership.');
    } finally {
      setEndBusy(null);
    }
  }

  /**
   * TERM-6: the direct door for an ended member. Touches only status/
   * endedAt on the backend — never memberRole, never location grants (the
   * member's old grants were never deleted by ending them, so nothing here
   * needs to re-grant anything).
   */
  async function reactivateMember(userId: string) {
    setReactivateBusy(userId);
    setErr(null);
    try {
      await api.post(`/admin/terminal/companies/${company.id}/members/${userId}/reactivate`, {});
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not reactivate that membership.');
    } finally {
      setReactivateBusy(null);
    }
  }

  /** TERM-6: scoped to an ACTIVE member only — the backend 404s otherwise. */
  async function grantLocation(userId: string) {
    const locationId = grantPick[userId];
    if (!locationId) return;
    setLocationActionBusy(`${userId}:grant`);
    setErr(null);
    try {
      await api.post(`/admin/terminal/companies/${company.id}/members/${userId}/locations`, { locationId });
      setGrantPick((prev) => {
        const { [userId]: _drop, ...rest } = prev;
        return rest;
      });
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not grant that location.');
    } finally {
      setLocationActionBusy(null);
    }
  }

  async function revokeLocation(userId: string, locationId: string) {
    setLocationActionBusy(`${userId}:${locationId}`);
    setErr(null);
    try {
      await api.del(`/admin/terminal/companies/${company.id}/members/${userId}/locations/${locationId}`);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not revoke that location.');
    } finally {
      setLocationActionBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Members</h3>
      {err && <Alert tone="warning" className="mt-2">{err}</Alert>}

      {company.members.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted)]">No members yet — invite one below.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {company.members.map((m) => {
            const currentlyActiveGrants = m.locations.filter((l) => activeLocationIds.has(l.id));
            // grantMemberLocation 404s on anything but an ACTIVE member, so
            // this control only ever appears there -- not offered on an
            // ENDED row, where it would always fail.
            const grantableLocations = company.locations.filter((l) => l.isActive && !currentlyActiveGrants.some((g) => g.id === l.id));
            return (
              <li key={m.id} className="px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <span className="font-medium text-belize-navy">{m.name}</span>{' '}
                    <span className="text-xs text-slate-500">{m.email}</span>{' '}
                    <Badge tone={m.memberRole === 'MANAGER' ? 'brand' : 'neutral'}>{m.memberRole}</Badge>{' '}
                    <Badge tone={m.status === 'ACTIVE' ? 'success' : 'neutral'}>{m.status}</Badge>
                  </div>
                  {canManage && m.status === 'ACTIVE' && (
                    <Button variant="ghost" size="sm" disabled={endBusy === m.userId} onClick={() => void endMember(m.userId)}>
                      {endBusy === m.userId ? 'Ending…' : 'End membership'}
                    </Button>
                  )}
                  {canManage && m.status === 'ENDED' && (
                    <Button variant="outline" size="sm" disabled={reactivateBusy === m.userId} onClick={() => void reactivateMember(m.userId)}>
                      {reactivateBusy === m.userId ? 'Reactivating…' : 'Reactivate'}
                    </Button>
                  )}
                </div>
                <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                  {currentlyActiveGrants.length === 0
                    ? // Not an error -- this is exactly the "no implicit whole-company
                      // grant" rule made visible: a MANAGER with zero active
                      // locations sees nothing, same as an OPERATOR would.
                      'No active locations — this member currently has no access, regardless of role.'
                    : `Active at: ${currentlyActiveGrants.map((l) => l.hub.name).join(', ')}`}
                  {m.locations.length > currentlyActiveGrants.length &&
                    ` (${m.locations.length - currentlyActiveGrants.length} granted location${m.locations.length - currentlyActiveGrants.length === 1 ? '' : 's'} since deactivated)`}
                </p>
                {m.status === 'ACTIVE' && canManage && currentlyActiveGrants.length > 0 && (
                  <ul className="mt-1 flex flex-wrap gap-1">
                    {currentlyActiveGrants.map((l) => (
                      <li
                        key={l.id}
                        className="inline-flex items-center gap-1 rounded-bmpl-sm border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs text-[color:var(--bmpl-text-secondary)]"
                      >
                        {l.hub.name}
                        <button
                          type="button"
                          disabled={locationActionBusy === `${m.userId}:${l.id}`}
                          onClick={() => void revokeLocation(m.userId, l.id)}
                          aria-label={`Revoke ${l.hub.name} from ${m.name}`}
                          className="font-semibold text-[color:var(--bmpl-text-muted)] hover:text-amber-800 disabled:opacity-50"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {m.status === 'ACTIVE' && canManage && grantableLocations.length > 0 && (
                  <div className="mt-1 flex flex-wrap items-center gap-2">
                    <Select
                      aria-label={`Grant ${m.name} a location`}
                      value={grantPick[m.userId] ?? ''}
                      onChange={(e) => setGrantPick((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                      className="h-7 py-0 text-xs"
                    >
                      <option value="">+ grant a location…</option>
                      {grantableLocations.map((l) => (
                        <option key={l.id} value={l.id}>
                          {l.hub.name} ({l.hub.code})
                        </option>
                      ))}
                    </Select>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={!grantPick[m.userId] || locationActionBusy === `${m.userId}:grant`}
                      onClick={() => void grantLocation(m.userId)}
                    >
                      {locationActionBusy === `${m.userId}:grant` ? 'Granting…' : 'Grant'}
                    </Button>
                  </div>
                )}
                {m.status === 'ACTIVE' && (
                  // No dead control here -- there is no way to change this
                  // member's ROLE in place (reactivateMember and
                  // grantMemberLocation both deliberately never touch
                  // memberRole), so this states the one path that works for
                  // THAT, rather than offering a role control that doesn't
                  // exist. Locations, above, no longer need this note.
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    To change {m.name}&apos;s role, end this membership and send a new invite.
                  </p>
                )}
                {m.status === 'ENDED' && (
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    Ended {when(m.endedAt)}. Reactivating restores the original location grants exactly as they were —
                    it does not re-ask for locations, the way a fresh invite would.
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {canManage && (
        <div className="mt-4 space-y-2 border-t border-[color:var(--bmpl-border-soft)] pt-3">
          <h4 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Invite a member</h4>
          <Field label="Email" htmlFor="tc-invite-email">
            <Input id="tc-invite-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="staff@company.bz" />
          </Field>
          <Field label="Role" htmlFor="tc-invite-role">
            <Select id="tc-invite-role" value={memberRole} onChange={(e) => setMemberRole(e.target.value as MemberRole)}>
              {MEMBER_ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field
            label="Locations (at least one — a role alone never grants access)"
            htmlFor="tc-invite-locations"
            hint={activeLocations.length === 0 ? 'No active locations exist yet -- attach one above first.' : undefined}
          >
            <div id="tc-invite-locations" className="space-y-1 rounded-bmpl-md border border-slate-200 p-2">
              {activeLocations.length === 0 ? (
                <p className="text-xs text-[color:var(--bmpl-text-muted)]">No active locations to grant.</p>
              ) : (
                activeLocations.map((l) => (
                  <label key={l.id} className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={pickedLocations.has(l.id)}
                      onChange={() => togglePicked(l.id)}
                      className="accent-belize-blue"
                    />
                    {l.hub.name} ({l.hub.code})
                  </label>
                ))
              )}
            </div>
          </Field>
          <Button type="button" disabled={inviteBusy || activeLocations.length === 0} onClick={() => void invite()}>
            {inviteBusy ? 'Sending…' : 'Send invite'}
          </Button>
          {delivery && (
            <Alert tone={deliveryMessage(delivery).tone === 'success' ? 'success' : 'warning'} className="mt-2">
              {deliveryMessage(delivery).text}
            </Alert>
          )}
        </div>
      )}
    </Card>
  );
}

function InvitesCard({
  company,
  canManage,
  onChanged,
}: {
  company: CompanyDetail;
  activeLocationIds: Set<string>;
  canManage: boolean;
  onChanged: () => void;
}) {
  const [revokeBusy, setRevokeBusy] = useState<string | null>(null);
  const [resendBusy, setResendBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [delivery, setDelivery] = useState<InviteDelivery | null>(null);

  /**
   * Resend rotates this invite's token server-side, because the raw token was
   * never stored and cannot be read back. The previous link stops working,
   * which is the point: a link that went astray dies when an admin resends.
   */
  async function resend(inviteId: string) {
    setResendBusy(inviteId);
    setErr(null);
    setDelivery(null);
    try {
      const res = await api.post<{ delivery?: InviteDelivery }>(
        `/admin/terminal/companies/${company.id}/invites/${inviteId}/resend`,
        {},
      );
      if (res?.delivery) setDelivery(res.delivery);
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not resend that invite.');
    } finally {
      setResendBusy(null);
    }
  }

  async function revoke(inviteId: string) {
    setRevokeBusy(inviteId);
    setErr(null);
    try {
      await api.post(`/admin/terminal/companies/${company.id}/invites/${inviteId}/revoke`, {});
      onChanged();
    } catch (e) {
      setErr((e as ApiError).message ?? 'Could not revoke that invite.');
    } finally {
      setRevokeBusy(null);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Pending invites</h3>
      {err && <Alert tone="warning" className="mt-2">{err}</Alert>}
      {delivery && (
        <Alert tone={deliveryMessage(delivery).tone === 'success' ? 'success' : 'warning'} className="mt-2">
          {deliveryMessage(delivery).text}
        </Alert>
      )}
      {company.pendingInvites.length === 0 ? (
        <p className="mt-2 text-sm text-[color:var(--bmpl-text-muted)]">No pending invites.</p>
      ) : (
        <ul className="mt-3 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {company.pendingInvites.map((inv) => (
            <li key={inv.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 text-sm">
              <div>
                <span className="font-medium text-belize-navy">{inv.email}</span>{' '}
                <Badge tone={inv.memberRole === 'MANAGER' ? 'brand' : 'neutral'}>{inv.memberRole}</Badge>{' '}
                <span className="text-xs text-slate-500">
                  {inv.locationCount} location{inv.locationCount === 1 ? '' : 's'} · expires {when(inv.expiresAt)}
                </span>
              </div>
              {canManage && (
                <div className="flex items-center gap-1">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={resendBusy === inv.id || revokeBusy === inv.id}
                    onClick={() => void resend(inv.id)}
                  >
                    {resendBusy === inv.id ? 'Resending…' : 'Resend'}
                  </Button>
                  <Button variant="ghost" size="sm" disabled={revokeBusy === inv.id || resendBusy === inv.id} onClick={() => void revoke(inv.id)}>
                    {revokeBusy === inv.id ? 'Revoking…' : 'Revoke'}
                  </Button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
