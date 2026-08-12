'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Alert, Button } from '../ui';
import { Card, DISTRICTS, districtLabel, errMessage, type ServiceArea } from './dashboard-data';

/**
 * The districts a driver will deliver in.
 *
 * Operationally load-bearing rather than a preference: dispatch only offers a
 * delivery to a driver whose ACTIVE service areas include the destination
 * district (`assignmentEligibility`), so a driver with none selected receives no
 * work at all. That is why it needed a route of its own instead of being the
 * last section of a very long page.
 */
export function ServiceAreasSection({ serviceAreas, onDone }: { serviceAreas: ServiceArea[]; onDone: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>(serviceAreas.filter((a) => a.isActive).map((a) => a.district));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put('/driver/service-areas', { districts: selected });
      setMsg('Service areas saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="Service areas">
      {msg && (
        <Alert tone="success" className="mb-4">
          {msg}
        </Alert>
      )}
      {err && (
        <Alert tone="error" className="mb-4">
          {err}
        </Alert>
      )}

      {selected.length === 0 && (
        <Alert tone="warning" className="mb-4">
          You have no service areas selected, so no deliveries can be offered to you. Choose at least one district.
        </Alert>
      )}

      <fieldset>
        <legend className="bmpl-label mb-1.5">Districts you can deliver in</legend>
        {/* Full-width rows on a phone rather than a wrapped inline list: a 16px
            checkbox with its label alongside is a poor one-handed target. */}
        <div className="mb-4 grid gap-1 sm:grid-cols-2">
          {DISTRICTS.map((d) => {
            const id = `sa-${d}`;
            const checked = selected.includes(d);
            return (
              <label
                key={d}
                htmlFor={id}
                className={`flex min-h-[44px] cursor-pointer items-center gap-2.5 rounded-bmpl-md border px-3 text-sm transition ${
                  checked ? 'border-belize-blue/40 bg-belize-blue/5 text-belize-navy' : 'border-slate-200 text-slate-700 hover:bg-slate-50'
                }`}
              >
                <input
                  id={id}
                  type="checkbox"
                  className="h-4 w-4 shrink-0 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30"
                  checked={checked}
                  onChange={(e) => setSelected(e.target.checked ? [...selected, d] : selected.filter((x) => x !== d))}
                />
                {districtLabel(d)}
              </label>
            );
          })}
        </div>
      </fieldset>
      <Button type="button" className="w-full sm:w-auto" disabled={busy} onClick={save}>
        Save service areas
      </Button>
    </Card>
  );
}
