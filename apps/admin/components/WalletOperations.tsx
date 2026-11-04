'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../lib/api';
import { Alert, Button, Card } from './ui';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * The two wallet actions an administrator can take, and nothing else.
 *
 * Neither is a balance adjustment. One posts a labelled simulation credit
 * through the ordinary ledger; the other gives back reservations that were
 * never authorized. There is still no way to set a balance from this console,
 * and that is deliberate — the ledger is the record, and a screen that could
 * overwrite it would make it not the record.
 *
 * The credit form asks for a reason because an unexplained credit in the audit
 * log is only half a record, and it says TEST CREDIT in the interface as well
 * as in the transaction description, so nobody has to remember which button
 * makes simulated money.
 */
export function WalletOperations({ onChanged }: { onChanged?: () => void }) {
  // Each card is drawn only for the specific permission its own write call
  // needs — wallet.credit_test and wallet.reconcile are two different,
  // HIGHLY RESTRICTED permissions (neither is in any standing bundle), not
  // one boolean covering both. /me returns the same grant rows the
  // PermissionsGuard evaluates, so what this screen shows and what the API
  // enforces cannot disagree. On any doubt (request fails, field absent)
  // both stay hidden: fail closed. Reaching this component only ever needed
  // wallet.read (BMPL-270) — until now, anyone who could view the wallet
  // page also saw both money-creation forms rendered, whether or not they
  // held either restricted permission.
  const [canCreditTest, setCanCreditTest] = useState(false);
  const [canReconcile, setCanReconcile] = useState(false);

  useEffect(() => {
    api
      .get<{ adminPermissions?: string[] }>('/me')
      .then((me) => {
        const perms = me.adminPermissions ?? [];
        setCanCreditTest(perms.includes('wallet.credit_test'));
        setCanReconcile(perms.includes('wallet.reconcile'));
      })
      .catch(() => {
        setCanCreditTest(false);
        setCanReconcile(false);
      });
  }, []);

  if (!canCreditTest && !canReconcile) return null;

  return (
    <div className="mb-8 grid gap-3 lg:grid-cols-2">
      {canCreditTest && <TestCreditCard onChanged={onChanged} />}
      {canReconcile && <StaleHoldCard onChanged={onChanged} />}
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
 * stale one left over from an earlier lookup.
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
