'use client';

import { useState } from 'react';
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
  return (
    <div className="mb-8 grid gap-3 lg:grid-cols-2">
      <TestCreditCard onChanged={onChanged} />
      <StaleHoldCard onChanged={onChanged} />
    </div>
  );
}

function TestCreditCard({ onChanged }: { onChanged?: () => void }) {
  const [userId, setUserId] = useState('');
  const [amount, setAmount] = useState('80.00');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const amountMinor = Math.round(Number(amount) * 100);
  const valid = userId.trim().length > 0 && Number.isFinite(amountMinor) && amountMinor >= 100 && reason.trim().length >= 3;

  async function submit() {
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api.post<{ availableMinor: number }>('/admin/wallet/test-credit', {
        userId: userId.trim(),
        amountMinor,
        reason: reason.trim(),
      });
      setNote(`Posted ${money(amountMinor)}. Their available balance is now ${money(res.availableMinor)}.`);
      setUserId('');
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
        <h3 className="text-sm font-semibold text-slate-900">Administrative test credit</h3>
        <span className="rounded bg-amber-100 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-amber-800">
          Test credit
        </span>
      </div>
      <p className="mt-1 text-sm text-slate-500">
        Posts simulation money through the ordinary ledger so a real person can exercise checkout without a real payment
        rail. It is marked as test money whoever receives it, and it cannot be withdrawn as cash.
      </p>

      {note && <Alert tone="success" className="mt-3">{note}</Alert>}
      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      <div className="mt-3 space-y-3">
        <Field label="Customer user ID" htmlFor="tc-user">
          <input
            id="tc-user"
            value={userId}
            onChange={(e) => setUserId(e.target.value)}
            placeholder="cmsgz…"
            className={input}
          />
        </Field>
        <Field label="Amount (BZ$)" htmlFor="tc-amount">
          <input id="tc-amount" value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal" className={input} />
        </Field>
        <Field label="Reason (recorded in the audit log)" htmlFor="tc-reason">
          <input
            id="tc-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why this credit is being granted"
            className={input}
          />
        </Field>
        <Button onClick={submit} disabled={!valid || busy} className="min-h-[44px]">
          {busy ? 'Posting…' : `Post ${money(Number.isFinite(amountMinor) ? amountMinor : 0)} test credit`}
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
      <h3 className="text-sm font-semibold text-slate-900">Release stale wallet holds</h3>
      <p className="mt-1 text-sm text-slate-500">
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
      <label htmlFor={htmlFor} className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
        {label}
      </label>
      <div className="mt-1">{children}</div>
    </div>
  );
}
