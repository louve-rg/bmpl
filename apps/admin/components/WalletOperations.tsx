'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import { Alert, Button, Card } from './ui';
import { StatusBadge } from './StatusBadge';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * The administrative wallet actions available from this console, and
 * nothing else: a labelled simulation credit, releasing reservations that
 * were never authorized, and the fraud/security lock. None of the three is
 * a balance adjustment -- there is still no way to set a balance from this
 * console, and that is deliberate -- the ledger is the record, and a screen
 * that could overwrite it would make it not the record.
 *
 * Every write here asks for a reason because an unexplained action in the
 * audit log is only half a record. The credit card says TEST CREDIT in the
 * interface as well as in the transaction description, so nobody has to
 * remember which button makes simulated money; the lock card says FRAUD /
 * SECURITY for the same reason.
 */
export function WalletOperations({ onChanged }: { onChanged?: () => void }) {
  // Each card is drawn only for the specific permission its own write call
  // needs — wallet.credit_test, wallet.reconcile and wallet.lock are three
  // different, HIGHLY RESTRICTED permissions (none in any standing bundle),
  // not one boolean covering all three. /me returns the same grant rows the
  // PermissionsGuard evaluates, so what this screen shows and what the API
  // enforces cannot disagree. On any doubt (request fails, field absent)
  // all three stay hidden: fail closed. Reaching this component only ever
  // needed wallet.read (BMPL-270) — until now, anyone who could view the
  // wallet page also saw both money-creation forms rendered, whether or not
  // they held either restricted permission.
  const [canCreditTest, setCanCreditTest] = useState(false);
  const [canReconcile, setCanReconcile] = useState(false);
  const [canLock, setCanLock] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => {
        const perms = me.adminPermissions ?? [];
        setCanCreditTest(perms.includes('wallet.credit_test'));
        setCanReconcile(perms.includes('wallet.reconcile'));
        setCanLock(perms.includes('wallet.lock'));
      })
      .catch(() => {
        setCanCreditTest(false);
        setCanReconcile(false);
        setCanLock(false);
      });
  }, []);

  if (!canCreditTest && !canReconcile && !canLock) return null;

  return (
    <div className="mb-8 grid gap-3 lg:grid-cols-2">
      {canCreditTest && <TestCreditCard onChanged={onChanged} />}
      {canReconcile && <StaleHoldCard onChanged={onChanged} />}
      {canLock && <WalletLockCard onChanged={onChanged} />}
    </div>
  );
}

interface ResolvedAccount {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
}

/**
 * Finding a customer by name or email, reusing the same search the Users
 * page already has (`GET /admin/users?query=`, `app/dashboard/users/page.tsx`)
 * rather than inventing a second one. This is strictly an alternative way to
 * populate `onSelect` with a resolved account -- it does not touch, replace
 * or weaken the existing id-field-plus-"Look up" control either card already
 * had; both paths end at the same identity-confirmed state (ADMIN-WALLET-
 * LOOKUP, owner correction: a fraud-lock tool whose only way to identify a
 * customer is copying a cuid out of the address bar is not usable).
 */
function AccountSearch({ idPrefix, onSelect }: { idPrefix: string; onSelect: (account: ResolvedAccount) => void }) {
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [results, setResults] = useState<ResolvedAccount[] | null>(null);

  async function search() {
    const q = query.trim();
    if (!q) return;
    setBusy(true);
    setErr(null);
    setResults(null);
    try {
      const res = await api.get<{ total: number; items: ResolvedAccount[] }>(`/admin/users?query=${encodeURIComponent(q)}`);
      setResults(res.items);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Search failed.');
    } finally {
      setBusy(false);
    }
  }

  function pick(account: ResolvedAccount) {
    onSelect(account);
    setResults(null);
    setQuery('');
    setErr(null);
  }

  return (
    <Field label="Or search by name or email" htmlFor={`${idPrefix}-search`}>
      <div className="flex gap-2">
        <input
          id={`${idPrefix}-search`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void search();
            }
          }}
          placeholder="Jane Doe, or jane@…"
          className={input}
        />
        <Button type="button" variant="outline" onClick={search} disabled={!query.trim() || busy} className="min-h-[44px] shrink-0">
          {busy ? 'Searching…' : 'Search'}
        </Button>
      </div>
      {err && (
        <Alert tone="warning" className="mt-2">
          {err}
        </Alert>
      )}
      {results && results.length === 0 && (
        <Alert tone="info" className="mt-2">
          No matching accounts.
        </Alert>
      )}
      {results && results.length > 0 && (
        <ul className="mt-2 divide-y divide-slate-200 rounded-bmpl-md border border-slate-200 bg-white">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => pick(r)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
              >
                <span className="font-medium text-belize-navy">
                  {r.firstName} {r.lastName}
                </span>
                <span className="text-xs text-slate-500">{r.email}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Field>
  );
}

/**
 * This card used to post straight to a raw, free-text user id with no
 * lookup and no confirmation -- an admin who mistyped or pasted the wrong
 * id would credit the wrong account, a real customer included, with no
 * signal until after the write had already happened (SHIPPING-E2E-CLOSE,
 * reported against this exact field). The fix reuses the admin console's
 * own existing account lookup (`GET /admin/users/:id`, the same route the
 * user-detail page calls) rather than building a new one: the typed id
 * must resolve to a name and email BEFORE the amount/reason fields even
 * unlock, and the submit button itself names the resolved person, so there
 * is no way to post a credit without having first seen who it goes to.
 *
 * Changing the id after a successful lookup clears the resolution and
 * re-locks the form -- the credit always fires against whichever account
 * was most recently resolved for the id currently in the box, never a
 * stale one left over from an earlier lookup. Picking a name/email search
 * result (ADMIN-WALLET-LOOKUP) goes through the exact same `selectAccount`
 * path a successful id lookup does, so it is held to the identical guard.
 *
 * The disabled attribute on the submit button is a hint, not the control:
 * `submit()` re-checks `resolved.id === userId.trim()` itself before the
 * POST ever fires, so a stale render or a future refactor that moves the
 * button cannot post a credit to an unconfirmed id.
 */
function TestCreditCard({ onChanged }: { onChanged?: () => void }) {
  const [userId, setUserId] = useState('');
  const [resolved, setResolved] = useState<ResolvedAccount | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [amount, setAmount] = useState('80.00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amountMinor = Math.round(Number(amount) * 100);
  const valid =
    !!resolved &&
    resolved.id === userId.trim() &&
    Number.isFinite(amountMinor) &&
    amountMinor >= 100 &&
    reason.trim().length >= 3;

  function changeUserId(value: string) {
    setUserId(value);
    // Any edit invalidates the last lookup -- the form must re-confirm
    // identity for whatever id is in the box now, not the one it was for.
    setResolved(null);
    setLookupErr(null);
  }

  function selectAccount(picked: ResolvedAccount) {
    setUserId(picked.id);
    setResolved(picked);
    setLookupErr(null);
  }

  async function lookup() {
    const id = userId.trim();
    if (!id) return;
    setLookupBusy(true);
    setLookupErr(null);
    setResolved(null);
    try {
      const account = await api.get<ResolvedAccount>(`/admin/users/${encodeURIComponent(id)}`);
      setResolved(account);
    } catch (e) {
      const ex = e as ApiError;
      setLookupErr(ex.message ?? 'Could not look up that account.');
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit() {
    if (!resolved || resolved.id !== userId.trim()) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api.post<{ availableMinor: number }>('/admin/wallet/test-credit', {
        userId: resolved.id,
        amountMinor,
        reason: reason.trim(),
      });
      setNote(`Posted ${money(amountMinor)} to ${resolved.firstName} ${resolved.lastName}. Their available balance is now ${money(res.availableMinor)}.`);
      setUserId('');
      setResolved(null);
      setReason('');
      onChanged?.();
    } catch (e) {
      const ex = e as ApiError;
      setErr(ex.errors?.[0]?.message ?? ex.message ?? 'The credit could not be posted.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Administrative test credit</h3>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
          Test credit
        </span>
      </div>
      <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted)]">
        Posts simulation money through the ordinary ledger so a real person can exercise checkout without a real payment
        rail. It is marked as test money whoever receives it, and it cannot be withdrawn as cash.
      </p>

      {note && <Alert tone="success" className="mt-3">{note}</Alert>}
      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      <div className="mt-3 space-y-3">
        <AccountSearch idPrefix="tc" onSelect={selectAccount} />
        <Field label="Customer user ID" htmlFor="tc-user">
          <div className="flex gap-2">
            <input
              id="tc-user"
              value={userId}
              onChange={(e) => changeUserId(e.target.value)}
              placeholder="cmsgz…"
              className={input}
            />
            <Button
              type="button"
              variant="outline"
              onClick={lookup}
              disabled={!userId.trim() || lookupBusy}
              className="min-h-[44px] shrink-0"
            >
              {lookupBusy ? 'Looking up…' : 'Look up'}
            </Button>
          </div>
        </Field>
        {lookupErr && <Alert tone="warning">{lookupErr}</Alert>}
        {resolved && (
          <Alert tone="info">
            This will credit <strong>{resolved.firstName} {resolved.lastName}</strong> ({resolved.email}).
          </Alert>
        )}
        <Field label="Amount (BZ$)" htmlFor="tc-amount">
          <input
            id="tc-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            disabled={!resolved}
            className={input}
          />
        </Field>
        <Field label="Reason (recorded in the audit log)" htmlFor="tc-reason">
          <input
            id="tc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this credit is being granted"
            disabled={!resolved}
            className={input}
          />
        </Field>
        <Button onClick={submit} disabled={!valid || busy} className="min-h-[44px]">
          {busy
            ? 'Posting…'
            : resolved
              ? `Confirm: credit ${money(Number.isFinite(amountMinor) ? amountMinor : 0)} to ${resolved.firstName} ${resolved.lastName}`
              : `Post ${money(Number.isFinite(amountMinor) ? amountMinor : 0)} test credit`}
        </Button>
      </div>
    </Card>
  );
}

interface LockableAccount {
  id: string;
  type: string;
  status: string;
  currency: string;
  cachedBalanceMinor: number;
}

/**
 * The fraud/security lock, exposed for the first time (SHIPPING-E2E-CLOSE)
 * -- the API has carried `POST /admin/wallet/users/:userId/lock` and
 * `/unlock` since before this card existed, gated on `wallet.lock`, with no
 * UI surface at all.
 *
 * Same confirm-before-write shape as `TestCreditCard` just above, and for
 * the same reason: no free-text id posts directly, the typed id must
 * resolve through the existing account lookup first, and `submit()`
 * re-checks the resolution itself rather than trusting the disabled
 * button. One difference, because a lock is not symmetric with a credit:
 * crediting the wrong person is recoverable by reconciliation, but locking
 * the wrong person cuts a real customer off from booking immediately with
 * no notification to them. So the confirm button names the DIRECTION as
 * well as the person ("Confirm: lock Jane Doe's wallet"), not just the
 * person -- the realistic failure here is one mis-click between two
 * adjacent buttons, not a mistyped id.
 *
 * Current status has to come from somewhere other than attempting the
 * action: `GET /admin/wallet/users/:userId/accounts` (wallet.read, read
 * only, no audit row) is the read half of this feature -- attempting
 * `lock` on an ACTIVE wallet to "see" the current state would actually
 * lock it, which is not an inspection method this console will offer.
 *
 * Picking a name/email search result (ADMIN-WALLET-LOOKUP) sets identity
 * the same way a successful id lookup does, then still fetches this
 * card's own wallet-accounts read -- a search hit does not carry status
 * or balance, so the direction-from-status derivation stays intact either
 * way the account got here.
 */
function WalletLockCard({ onChanged }: { onChanged?: () => void }) {
  const [userId, setUserId] = useState('');
  const [resolved, setResolved] = useState<ResolvedAccount | null>(null);
  const [accounts, setAccounts] = useState<LockableAccount[] | null>(null);
  const [lookupBusy, setLookupBusy] = useState(false);
  const [lookupErr, setLookupErr] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const account = accounts?.[0] ?? null;
  const action: 'lock' | 'unlock' | null =
    account?.status === 'ACTIVE' ? 'lock' : account?.status === 'LOCKED' ? 'unlock' : null;
  const valid = !!resolved && resolved.id === userId.trim() && !!account && !!action && reason.trim().length >= 3;

  function changeUserId(value: string) {
    setUserId(value);
    setResolved(null);
    setAccounts(null);
    setLookupErr(null);
  }

  async function fetchAccounts(id: string) {
    const userAccounts = await api.get<LockableAccount[]>(`/admin/wallet/users/${encodeURIComponent(id)}/accounts`);
    setAccounts(userAccounts.filter((a) => a.type === 'USER'));
  }

  async function lookup() {
    const id = userId.trim();
    if (!id) return;
    setLookupBusy(true);
    setLookupErr(null);
    setResolved(null);
    setAccounts(null);
    try {
      const [person] = await Promise.all([api.get<ResolvedAccount>(`/admin/users/${encodeURIComponent(id)}`), fetchAccounts(id)]);
      setResolved(person);
    } catch (e) {
      const ex = e as ApiError;
      setLookupErr(ex.message ?? 'Could not look up that account.');
    } finally {
      setLookupBusy(false);
    }
  }

  // The search result already carries identity (ADMIN-WALLET-LOOKUP) --
  // only the wallet-accounts half still needs fetching, same endpoint and
  // same USER-type filter `lookup()` uses, so the offered direction is
  // derived identically regardless of which path resolved the account.
  async function selectAccount(picked: ResolvedAccount) {
    setUserId(picked.id);
    setResolved(picked);
    setLookupErr(null);
    setAccounts(null);
    setLookupBusy(true);
    try {
      await fetchAccounts(picked.id);
    } catch (e) {
      const ex = e as ApiError;
      setLookupErr(ex.message ?? 'Could not look up that account.');
      setResolved(null);
    } finally {
      setLookupBusy(false);
    }
  }

  async function submit() {
    if (!resolved || resolved.id !== userId.trim() || !account || !action) return;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api.post<{ status: string }>(`/admin/wallet/users/${resolved.id}/${action}`, {
        reason: reason.trim(),
      });
      setNote(
        `${action === 'lock' ? 'Locked' : 'Unlocked'} ${resolved.firstName} ${resolved.lastName}'s wallet. Status is now ${res.status}.`,
      );
      setAccounts((prev) => prev?.map((a) => (a.id === account.id ? { ...a, status: res.status } : a)) ?? prev);
      setReason('');
      onChanged?.();
    } catch (e) {
      const ex = e as ApiError;
      setErr(ex.errors?.[0]?.message ?? ex.message ?? `The ${action} could not be posted.`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Wallet lock</h3>
        <span className="rounded bg-red-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-red-800">
          Fraud / security
        </span>
      </div>
      <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted)]">
        Removes a wallet's permission to originate new movement -- spend, top-up, test credit. Money already authorized
        keeps moving on its existing rails. The customer is not notified, so a lock should only follow a real fraud or
        security review.
      </p>

      {note && <Alert tone="success" className="mt-3">{note}</Alert>}
      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      <div className="mt-3 space-y-3">
        <AccountSearch idPrefix="wl" onSelect={selectAccount} />
        <Field label="Customer user ID" htmlFor="wl-user">
          <div className="flex gap-2">
            <input
              id="wl-user"
              value={userId}
              onChange={(e) => changeUserId(e.target.value)}
              placeholder="cmsgz…"
              className={input}
            />
            <Button
              type="button"
              variant="outline"
              onClick={lookup}
              disabled={!userId.trim() || lookupBusy}
              className="min-h-[44px] shrink-0"
            >
              {lookupBusy ? 'Looking up…' : 'Look up'}
            </Button>
          </div>
        </Field>
        {lookupErr && <Alert tone="warning">{lookupErr}</Alert>}
        {resolved && !account && (
          <Alert tone="warning">
            {resolved.firstName} {resolved.lastName} ({resolved.email}) has no wallet account to lock.
          </Alert>
        )}
        {resolved && account && (
          <Alert tone="info">
            <strong>{resolved.firstName} {resolved.lastName}</strong> ({resolved.email}) — wallet status{' '}
            <StatusBadge status={account.status} />, balance {money(account.cachedBalanceMinor)} {account.currency}.
            {account.status === 'SUSPENDED' && ' This wallet is suspended; suspension is not managed by the lock control.'}
          </Alert>
        )}
        <Field label="Reason (recorded in the audit log, visible to every wallet.lock holder)" htmlFor="wl-reason">
          <input
            id="wl-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={action === 'unlock' ? 'Why this wallet is being unlocked' : 'Why this wallet is being locked'}
            disabled={!action}
            className={input}
          />
        </Field>
        <Button
          onClick={submit}
          disabled={!valid || busy}
          variant={action === 'lock' ? 'destructive' : 'primary'}
          className="min-h-[44px]"
        >
          {busy
            ? action === 'lock'
              ? 'Locking…'
              : 'Unlocking…'
            : resolved && action
              ? `Confirm: ${action} ${resolved.firstName} ${resolved.lastName}'s wallet`
              : 'Confirm'}
        </Button>
      </div>
    </Card>
  );
}

function StaleHoldCard({ onChanged }: { onChanged?: () => void }) {
  const [hours, setHours] = useState('24');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ examined: number; expired: string[] } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    setResult(null);
    try {
      setResult(
        await api.post<{ examined: number; expired: string[] }>('/admin/payments/expire-stale-holds', {
          olderThanHours: Number(hours) || 24,
        }),
      );
      onChanged?.();
    } catch (e) {
      setErr((e as ApiError).message ?? 'The sweep could not run.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Release stale wallet holds</h3>
      <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted)]">
        A hold placed at checkout that was never authorized reserves money the customer cannot spend and cannot get
        back. This gives those reservations back and cancels the orders behind them. It runs hourly on its own; this is
        for when it needs to happen now.
      </p>

      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}
      {result && (
        <Alert tone={result.expired.length > 0 ? 'success' : 'info'} className="mt-3">
          Examined {result.examined}. Released {result.expired.length}.
        </Alert>
      )}

      <div className="mt-3 space-y-3">
        <Field label="Older than (hours)" htmlFor="sh-hours">
          <input id="sh-hours" value={hours} onChange={(e) => setHours(e.target.value)} inputMode="numeric" className={input} />
        </Field>
        <Button variant="outline" onClick={run} disabled={busy} className="min-h-[44px]">
          {busy ? 'Sweeping…' : 'Release stale holds'}
        </Button>
      </div>
    </Card>
  );
}

const input =
  'w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-sm text-slate-900 focus:border-belize-blue focus:outline-none focus:ring-2 focus:ring-belize-blue/30';

function Field({ label, htmlFor, children }: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wide text-[color:var(--bmpl-text-muted)]">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
