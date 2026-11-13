'use client';

import { useState } from 'react';
import { api, type ApiError } from '../../../../lib/api';
import { Alert, Badge, Button, Card } from '../../../../components/ui';

/**
 * TERM-SIM-DESIGNATE: `POST /admin/users/test-flag` (admin.controller.ts,
 * `users.suspend`, audited, `AdminService.setTestFlag`) has existed with no
 * caller anywhere in `apps/admin` or `apps/web` -- only API tests, seeds
 * and e2e drove it. An `isTest` account is the only kind that sees the
 * simulation network, so every hand-registered tester, Edward included,
 * needed a developer with an admin token just to book a simulation leg.
 *
 * Built to the same standard as `WalletOperations.tsx`'s test-credit card:
 * identity is already resolved (this card lives on the user's own detail
 * page, unlike the wallet console's cross-account lookup), the current
 * state is shown honestly before any action -- an admin who cannot see the
 * current value would flip it blind -- a reason is required, and a real
 * success message names the outcome rather than a generic "done".
 *
 * Gated on `users.suspend`, same as `AccountActions` on this same page --
 * that is the permission the endpoint itself requires (`@RequirePermission
 * ('users.suspend')`); whether it is the RIGHT permission for this
 * operation is a product-design question left alone here, per the card's
 * own instruction.
 */
export function TestFlagCard({
  userId,
  firstName,
  lastName,
  isTest,
  canSet = false,
}: {
  userId: string;
  firstName: string;
  lastName: string;
  isTest: boolean;
  canSet?: boolean;
}) {
  const [currentIsTest, setCurrentIsTest] = useState(isTest);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (!canSet) return null;

  const name = `${firstName} ${lastName}`;
  // Same server minimum as setUserTestFlagSchema (packages/validation/src/
  // admin.ts) -- a client-side hint only; the server check is the one that
  // matters, same relationship WalletOperations' amount ceiling hint has to
  // its own server-side cap.
  const validReason = reason.trim().length >= 4;

  async function submit() {
    if (!validReason) return;
    const nextIsTest = !currentIsTest;
    setBusy(true);
    setErr(null);
    setNote(null);
    try {
      const res = await api.post<{ userId: string; isTest: boolean; changed: boolean }>('/admin/users/test-flag', {
        userId,
        isTest: nextIsTest,
        reason: reason.trim(),
      });
      setCurrentIsTest(res.isTest);
      setNote(
        res.isTest
          ? `${name} is now a simulation account.`
          : `${name} is no longer a simulation account.`,
      );
      setReason('');
    } catch (e) {
      const ex = e as ApiError;
      setErr(ex.errors?.[0]?.message ?? ex.message ?? 'The simulation designation could not be changed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-5 p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Simulation designation</h2>
        {currentIsTest && <Badge tone="neutral">Simulation</Badge>}
      </div>
      <p className="text-sm text-slate-700">
        {currentIsTest
          ? `${name} is currently a simulation account. They see the simulation network and may fund their wallet with test money; nothing they book or pay for is real.`
          : `${name} is not a simulation account -- a real account on the real network.`}
      </p>

      {note && <Alert tone="success" className="mt-3">{note}</Alert>}
      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      <div className="mt-3 space-y-3">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Reason (recorded in the audit log)
          </span>
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={currentIsTest ? 'Why this simulation designation is being removed' : 'Why this account is being designated for simulation'}
            className="w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-sm text-slate-900 focus:border-belize-blue focus:outline-none focus:ring-2 focus:ring-belize-blue/30"
          />
        </label>
        <Button onClick={submit} disabled={!validReason || busy} variant={currentIsTest ? 'outline' : 'primary'} className="min-h-[44px]">
          {busy ? 'Saving…' : currentIsTest ? 'Remove simulation designation' : 'Mark as simulation account'}
        </Button>
      </div>
    </Card>
  );
}
