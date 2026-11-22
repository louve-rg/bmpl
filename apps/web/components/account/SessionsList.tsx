'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Alert, Badge, Button, Card } from '../ui';
import {
  sessionsApi,
  describeClient,
  describeUserAgent,
  formatSessionTime,
  type SessionRow,
} from '../../lib/sessions';

/**
 * ACCT-SESSIONS (#811): a list of the caller's own live sessions, a per-row
 * "sign out", and a "sign out everywhere else" action.
 *
 * `current: true` on exactly one row (the session that authenticated this
 * very page load) is marked with a badge rather than left for the person to
 * work out -- a list of otherwise-identical rows invites signing yourself
 * out by accident, so the consequence of each button has to be legible
 * BEFORE it is pressed, not after. Revoking the current row is honest and
 * allowed: the server clears the auth cookies when that id matches the
 * caller's own session, so this component treats it as a different action
 * from revoking any other row and redirects to /login the moment it
 * succeeds (same pattern DeleteAccountForm already uses). Revoking any
 * other row just removes it from this list; this device stays signed in.
 *
 * window.confirm is the same acknowledgement control "End membership"
 * (dashboard/terminal/page.tsx's endMember) already uses -- both revoking a
 * session and ending a membership are REVERSIBLE (sign back in; reactivate),
 * so window.confirm's one real gap (a browser with dialogs suppressed makes
 * it return `false` exactly like a decline) is tolerable here. Since
 * acceptance round 2, DeleteAccountForm no longer uses window.confirm at
 * all -- deleting an account is the one IRREVERSIBLE action in this set, and
 * it gets its own in-page confirmation panel instead. See that file's doc
 * comment for the rule.
 *
 * Neither raw `ipAddress` nor raw `userAgent` is ever rendered. See
 * lib/sessions.ts's `describeClient`/`describeUserAgent`: both derive their
 * label from what the server actually sent (the client platform tag, or
 * substrings of the UA string) -- never an invented device name. A session
 * whose User-Agent parses to nothing recognisable shows "Unknown device",
 * an honest fallback, not a guess.
 */
export function SessionsList() {
  const router = useRouter();
  const [sessions, setSessions] = useState<SessionRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [revokingOthers, setRevokingOthers] = useState(false);

  function load() {
    sessionsApi
      .list()
      .then((res) => setSessions(res.sessions))
      .catch(() => setLoadError('Unable to load your sessions.'));
  }

  useEffect(() => {
    load();
  }, []);

  async function revoke(row: SessionRow) {
    const question = row.current
      ? 'Sign out of this device? You will be signed out immediately and need to log in again.'
      : 'Sign out that device? It will need to log in again there.';
    if (!window.confirm(question)) return;

    setActionError(null);
    setNotice(null);
    setActingId(row.id);
    try {
      await sessionsApi.revoke(row.id);
      if (row.current) {
        router.push('/login');
        router.refresh();
        return;
      }
      setSessions((prev) => (prev ? prev.filter((s) => s.id !== row.id) : prev));
    } catch {
      // Already gone (or never yours -- the server deliberately makes the
      // two indistinguishable) is still a correct outcome here, not an
      // error to dwell on: refresh the list rather than claim a cause.
      setActionError('That session is no longer active.');
      load();
    } finally {
      setActingId(null);
    }
  }

  async function revokeOthers() {
    if (!window.confirm('Sign out every other device? This device stays signed in.')) return;

    setActionError(null);
    setNotice(null);
    setRevokingOthers(true);
    try {
      const res = await sessionsApi.revokeOthers();
      setSessions((prev) => (prev ? prev.filter((s) => s.current) : prev));
      setNotice(
        res.revokedCount > 0
          ? `Signed out ${res.revokedCount} other device${res.revokedCount === 1 ? '' : 's'}.`
          : 'No other devices were signed in.',
      );
    } catch {
      setActionError('Unable to sign out other devices just now.');
    } finally {
      setRevokingOthers(false);
    }
  }

  if (loadError) {
    return <Alert tone="warning">{loadError}</Alert>;
  }

  if (!sessions) {
    return <p className="text-sm text-[color:var(--bmpl-text-muted)]">Loading your sessions…</p>;
  }

  const hasOthers = sessions.some((s) => !s.current);

  return (
    <Card className="p-6">
      {actionError && (
        <Alert tone="warning" className="mb-4">
          {actionError}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" className="mb-4">
          {notice}
        </Alert>
      )}

      {sessions.length === 0 ? (
        <p className="text-sm text-[color:var(--bmpl-text-muted)]">No active sessions.</p>
      ) : (
        <ul className="space-y-3">
          {sessions.map((row) => {
            const device = describeUserAgent(row.userAgent) ?? 'Unknown device';
            return (
              <li
                key={row.id}
                className="flex items-center justify-between gap-4 rounded-md border border-[color:var(--bmpl-border)] p-3"
              >
                <div>
                  <p className="text-sm font-medium text-[color:var(--bmpl-text)]">
                    {device} · {describeClient(row.client)}
                    {row.current && (
                      <Badge tone="success" className="ml-2">
                        This device
                      </Badge>
                    )}
                  </p>
                  <p className="text-xs text-[color:var(--bmpl-text-muted)]">Last active {formatSessionTime(row.lastUsedAt)}</p>
                </div>
                <Button
                  type="button"
                  variant={row.current ? 'destructive' : 'ghost'}
                  size="sm"
                  disabled={actingId === row.id}
                  onClick={() => void revoke(row)}
                >
                  {actingId === row.id ? 'Signing out…' : row.current ? 'Sign out this device' : 'Sign out'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}

      {hasOthers && (
        <div className="mt-4 border-t border-[color:var(--bmpl-border)] pt-4">
          <Button type="button" variant="outline" size="sm" disabled={revokingOthers} onClick={() => void revokeOthers()}>
            {revokingOthers ? 'Signing out…' : 'Sign out everywhere else'}
          </Button>
        </div>
      )}
    </Card>
  );
}
