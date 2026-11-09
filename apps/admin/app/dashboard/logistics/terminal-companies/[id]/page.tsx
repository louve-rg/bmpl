'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../../lib/api';
import { adminCrumbs } from '../../../../../lib/admin-nav';
import { Alert, Badge, Button, Card, EmptyState, Field, Input, LoadingRow, PageHeader, Select, Spinner } from '../../../../../components/ui';

/**
 * TERM-4 — terminal company detail. Contract read from
 * apps/api/src/terminal/{terminal.controller.ts,terminal.service.ts} and
 * packages/validation/src/terminal.ts on origin/main (a80adf43), not
 * re-derived. The 8 admin operations below are the WHOLE surface — see
 * the list page's header comment for the 3 that do not exist yet (edit
 * company, reactivate a membership, grant/remove one member's location
 * after invite acceptance — Michael's ruling there also explains why the
 * first blocks reporting slice 1 complete and the other two don't) and
 * are therefore not offered here. No dead controls: every spot that
 * would need one of the three states the path that DOES work instead —
 * profile card (no edit button, a note), each ACTIVE member's row (no
 * edit-locations button, "end and re-invite"), each ENDED member's row
 * (no reactivate button, "a new invite restores it").
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

      <ProfileCard company={company} />
      <LocationsCard company={company} canManage={canManage} onChanged={load} />
      <MembersCard company={company} activeLocationIds={activeLocationIds} canManage={canManage} onChanged={load} />
      <InvitesCard company={company} activeLocationIds={activeLocationIds} canManage={canManage} onChanged={load} />
    </div>
  );
}

function ProfileCard({ company: c }: { company: CompanyDetail }) {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Profile</h3>
        <div className="flex gap-2">
          <Badge tone={c.isActive ? 'success' : 'neutral'}>{c.isActive ? 'Active' : 'Deactivated'}</Badge>
          {c.isTest && <Badge tone="neutral">Simulation</Badge>}
        </div>
      </div>
      <dl className="mt-3 grid gap-2 text-sm sm:grid-cols-2">
        <Row label="Contact" value={`${c.contactEmail}${c.contactPhone ? ` · ${c.contactPhone}` : ''}`} />
        <Row label="Created" value={when(c.createdAt) ?? '—'} />
      </dl>
      <p className="mt-3 text-xs text-[color:var(--bmpl-text-muted)]">
        Editing a company&apos;s own details is not available yet — there is no update endpoint for this on the current backend.
      </p>
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
  const [err, setErr] = useState<string | null>(null);

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
    try {
      await api.post(`/admin/terminal/companies/${company.id}/invites`, {
        email: email.trim(),
        memberRole,
        locationIds: Array.from(pickedLocations),
      });
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
                {m.status === 'ACTIVE' && (
                  // No dead control here -- there is no edit action for an
                  // existing member's own locations (see the file header's
                  // 3rd gap), so this states the path that DOES work rather
                  // than offering a button that would 404 or need a guessed
                  // endpoint shape.
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    To change {m.name}&apos;s locations or role, end this membership and send a new invite.
                  </p>
                )}
                {m.status === 'ENDED' && (
                  <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted)]">
                    Ended {when(m.endedAt)}. There is no direct reactivate action yet — sending a new invite to {m.email} restores the
                    membership (the backend's own accept flow reactivates an ended member).
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
  const [err, setErr] = useState<string | null>(null);

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
                <Button variant="ghost" size="sm" disabled={revokeBusy === inv.id} onClick={() => void revoke(inv.id)}>
                  {revokeBusy === inv.id ? 'Revoking…' : 'Revoke'}
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
