'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '../../lib/api';
import { shippingApi } from '../../lib/shipping';
import { Alert, Button } from '../ui';
import { Card, DISTRICTS, districtLabel, errMessage, type ServiceArea } from './dashboard-data';

/**
 * The districts — and, within a served district, the specific towns — a
 * driver will deliver in.
 *
 * Operationally load-bearing rather than a preference: dispatch only offers a
 * delivery to a driver whose ACTIVE service areas include the destination
 * district (`assignmentEligibility`), so a driver with none selected receives no
 * work at all. That is why it needed a route of its own instead of being the
 * last section of a very long page.
 *
 * Town narrowing is the SAME picker, not a second screen: one place to say
 * where a driver works, so it cannot disagree with itself. A district with no
 * towns picked means exactly what it always meant — the whole district — so
 * narrowing is purely optional and additive.
 *
 * Town OPTIONS come from the public terminal list (`GET /shipping/hubs`,
 * already used by checkout to show customers where BML operates) rather than
 * a free-text box. That list is BML-operator-curated geography — active,
 * non-simulation hubs an admin entered on the Logistics screen — never
 * something a driver types. Courier-lane-only towns (a town with a road but
 * no terminal, e.g. Ladyville) are deliberately NOT offered here: lanes are
 * explicitly never shown to anyone as a service in their own screen, and
 * widening that is a product decision, not a UI one. A driver who only
 * serves such a town keeps the whole district selected rather than narrowing
 * it, which is a reasonable (safe-by-default) understatement, never a false
 * widening.
 */
export function ServiceAreasSection({ serviceAreas, onDone }: { serviceAreas: ServiceArea[]; onDone: () => Promise<void> }) {
  const [selected, setSelected] = useState<string[]>(serviceAreas.filter((a) => a.isActive).map((a) => a.district));
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // Towns already saved on this district (even if the hub list no longer
  // configures that exact town) must stay served until the driver saves
  // something else.
  const servedDistricts = useMemo(() => new Set(serviceAreas.map((a) => a.district)), [serviceAreas]);

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

      <div className="mt-6 space-y-4 border-t border-slate-200 pt-5">
        <div>
          <h3 className="bmpl-label">Narrow a district to specific towns (optional)</h3>
          <p className="mt-1 text-sm text-slate-500">
            Pick particular towns only if you do not want the whole district. A district with no towns picked still
            means you cover all of it — nothing here narrows a district until you choose towns in it.
          </p>
        </div>
        {selected.filter((d) => servedDistricts.has(d)).length === 0 ? (
          <p className="text-sm text-slate-500">
            Save at least one service area above, then come back here to narrow it to specific towns.
          </p>
        ) : (
          selected
            .filter((d) => servedDistricts.has(d))
            .map((d) => (
              <DistrictCities
                key={d}
                district={d}
                initial={(serviceAreas.find((a) => a.district === d)?.cities ?? []).filter((c) => c.isActive).map((c) => c.city)}
                onDone={onDone}
              />
            ))
        )}
        {selected.some((d) => !servedDistricts.has(d)) && (
          <Alert tone="info">
            Save service areas above before narrowing a newly-added district to specific towns.
          </Alert>
        )}
      </div>
    </Card>
  );
}

/** One district's town picker + its own save, since narrowing is a separate
 *  endpoint (`PUT /driver/service-areas/:district/cities`) scoped to one
 *  district at a time. */
function DistrictCities({ district, initial, onDone }: { district: string; initial: string[]; onDone: () => Promise<void> }) {
  const [options, setOptions] = useState<string[]>([]);
  const [loadingOptions, setLoadingOptions] = useState(true);
  const [selectedCities, setSelectedCities] = useState<string[]>(initial);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    shippingApi
      .hubs()
      .then((hubs) => {
        if (cancelled) return;
        // Configured, BML-operator-curated towns for this district — never a
        // free-text invention. Union with whatever is already saved so a town
        // whose hub was since deactivated or renamed stays visible to uncheck,
        // rather than silently vanishing from the list.
        const fromHubs = hubs.filter((h) => h.district === district).map((h) => h.city);
        const merged = Array.from(new Set([...fromHubs, ...initial])).sort((a, b) => a.localeCompare(b));
        setOptions(merged);
      })
      .catch((e) => {
        if (!cancelled) setErr(errMessage(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingOptions(false);
      });
    return () => {
      cancelled = true;
    };
    // `initial` only changes when the parent reloads after a save; re-fetching
    // options on every keystroke isn't a concern since there are none here.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [district]);

  async function save() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.put(`/driver/service-areas/${district}/cities`, { cities: selectedCities });
      setMsg(selectedCities.length === 0 ? `Serving all of ${districtLabel(district)}.` : 'Towns saved.');
      await onDone();
    } catch (e) {
      setErr(errMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <fieldset className="rounded-bmpl-md border border-slate-200 p-3">
      <legend className="bmpl-label px-1 text-sm">{districtLabel(district)}</legend>
      {msg && (
        <Alert tone="success" className="mb-3">
          {msg}
        </Alert>
      )}
      {err && (
        <Alert tone="error" className="mb-3">
          {err}
        </Alert>
      )}
      {loadingOptions ? (
        <p className="text-sm text-slate-500">Loading configured towns…</p>
      ) : options.length === 0 ? (
        <p className="text-sm text-slate-500">
          No configured towns in {districtLabel(district)} yet — you serve the whole district.
        </p>
      ) : (
        <>
          <p className="mb-2 text-xs text-slate-500">
            {selectedCities.length === 0
              ? `Serving all of ${districtLabel(district)}.`
              : `Narrowed to ${selectedCities.length} town${selectedCities.length === 1 ? '' : 's'}.`}
          </p>
          <div className="grid gap-1 sm:grid-cols-2">
            {options.map((city) => {
              const id = `sa-${district}-city-${city}`;
              const checked = selectedCities.includes(city);
              return (
                <label
                  key={city}
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
                    onChange={(e) =>
                      setSelectedCities(e.target.checked ? [...selectedCities, city] : selectedCities.filter((c) => c !== city))
                    }
                  />
                  {city}
                </label>
              );
            })}
          </div>
        </>
      )}
      <Button type="button" variant="outline" className="mt-3 w-full sm:w-auto" disabled={busy || loadingOptions} onClick={save}>
        {selectedCities.length === 0 ? `Save — serve all of ${districtLabel(district)}` : 'Save towns'}
      </Button>
    </fieldset>
  );
}
