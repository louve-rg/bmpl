'use client';

import { useState } from 'react';
import { api, type ApiError } from '../lib/api';
import { Alert, Button, Card } from './ui';

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/**
 * What BML charges for a local door-to-door courier run.
 *
 * Two rates, and the separation is the point. A hub courier fee prices a run
 * between a terminal and an address; neither of those describes a run between
 * two addresses in the same town, which is the most common local shipment and
 * has no terminal in it at all.
 *
 * The production rate is one nationwide number, so setting it to exercise the
 * workflow would set it for every customer in the country. The simulation rate
 * applies only to designated test accounts, which is what makes it safe to put
 * a number in it before the real one has been decided.
 *
 * Zero is not free — a quote at zero says the price is not configured and
 * refuses to sell the journey.
 */
export function CourierPricing({
  productionMinor,
  simulationMinor,
}: {
  productionMinor: number;
  simulationMinor: number;
}) {
  const [production, setProduction] = useState((productionMinor / 100).toFixed(2));
  const [simulation, setSimulation] = useState((simulationMinor / 100).toFixed(2));
  const [busy, setBusy] = useState(false);
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const toMinor = (v: string) => Math.round(Number(v) * 100);
  const valid = Number.isFinite(toMinor(production)) && Number.isFinite(toMinor(simulation)) && toMinor(production) >= 0 && toMinor(simulation) >= 0;

  async function submit() {
    setBusy(true);
    setErr(null);
    setSaved(false);
    try {
      await api.patch('/admin/ops/settings', {
        localCourierFeeMinor: toMinor(production),
        localCourierFeeTestMinor: toMinor(simulation),
      });
      setSaved(true);
    } catch (e) {
      const ex = e as ApiError;
      setErr(ex.status === 403 ? 'You need the ops.manage permission to change pricing.' : (ex.message ?? 'Could not save.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-slate-900">Local courier pricing</h3>
      <p className="mt-1 text-sm text-slate-500">
        One courier, door to door, within a single town — the journey with no terminal in it.
      </p>

      {saved && <Alert tone="success" className="mt-3">Pricing saved.</Alert>}
      {err && <Alert tone="warning" className="mt-3">{err}</Alert>}

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="cp-prod" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Production rate (BZ$)
          </label>
          <input id="cp-prod" value={production} onChange={(e) => setProduction(e.target.value)} inputMode="decimal" className={input} />
          <p className="mt-1 text-xs text-slate-500">
            Charged to every real customer, nationwide. {toMinor(production) === 0 && 'Currently unset — local journeys are quoted as "price not configured".'}
          </p>
        </div>
        <div>
          <label htmlFor="cp-sim" className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
            Simulation rate (BZ$)
          </label>
          <input id="cp-sim" value={simulation} onChange={(e) => setSimulation(e.target.value)} inputMode="decimal" className={input} />
          <p className="mt-1 text-xs text-slate-500">Applies to designated test accounts only. Never charged to a real customer.</p>
        </div>
      </div>

      <Button onClick={submit} disabled={!valid || busy} className="mt-3 min-h-[44px]">
        {busy ? 'Saving…' : `Save (${money(toMinor(production) || 0)} live, ${money(toMinor(simulation) || 0)} test)`}
      </Button>
    </Card>
  );
}

const input =
  'mt-1 w-full min-h-[44px] rounded-bmpl-md border border-slate-300 px-3 text-sm text-slate-900 focus:border-belize-blue focus:outline-none focus:ring-2 focus:ring-belize-blue/30';
