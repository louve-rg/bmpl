'use client';

import { useEffect, useState } from 'react';
import { DISTRICTS, DISTRICT_LABELS, type District } from '@bmpl/shared';
import { api, type ApiError } from '../lib/api';
import { Alert, Badge, Card } from './ui';

/**
 * MDF-560 (owner): "I want the administrator configuration to be
 * straightforward, with clear validation and explanations when required
 * settings or driver coverage are missing." Same-town door-to-door has two
 * independent dependencies — the local courier rate (`CourierPricing`,
 * already surfaced) and an approved driver covering the destination
 * district. The second one had no admin surface at all: a booking could
 * fail at submit time for a reason nobody on the admin side could see
 * without opening the drivers list and filtering by hand, six times.
 *
 * Uses the same endpoint and filter Jim already used to count this by
 * hand — `GET /admin/drivers?district=&roleStatus=APPROVED` — rather than
 * re-deriving "what counts as coverage" (home district OR a service area)
 * a second time on this side. That definition lives once, server-side.
 */

type LoadState = 'loading' | 'ready' | 'error' | 'forbidden';

interface DistrictCoverage {
  district: District;
  approvedDrivers: number;
}

function apiStatus(err: unknown): number | undefined {
  return typeof err === 'object' && err !== null ? (err as ApiError).status : undefined;
}

export function DriverCoverage() {
  const [rows, setRows] = useState<DistrictCoverage[] | null>(null);
  const [state, setState] = useState<LoadState>('loading');

  useEffect(() => {
    let active = true;
    (async () => {
      setState('loading');
      try {
        const rows = await Promise.all(
          DISTRICTS.map(async (district) => {
            const drivers = await api.get<unknown[]>(
              `/admin/drivers?district=${district}&roleStatus=APPROVED`,
            );
            return { district, approvedDrivers: drivers.length };
          }),
        );
        if (!active) return;
        setRows(rows);
        setState('ready');
      } catch (err) {
        if (!active) return;
        setState(apiStatus(err) === 403 ? 'forbidden' : 'error');
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  const uncovered = rows?.filter((r) => r.approvedDrivers === 0) ?? [];

  return (
    <Card className="p-4">
      <h3 className="text-sm font-semibold text-[color:var(--bmpl-text)]">Same-town driver coverage</h3>
      <p className="mt-1 text-sm text-[color:var(--bmpl-text-muted)]">
        A door-to-door order needs an approved driver who covers its district — by home district or
        service area — or it cannot be dispatched.
      </p>

      {state === 'forbidden' ? (
        <Alert tone="warning" className="mt-3" title="Access restricted">
          You don&apos;t have the <code>drivers.read</code> permission.
        </Alert>
      ) : state === 'loading' ? (
        <p className="mt-3 text-sm text-slate-500">Checking driver coverage…</p>
      ) : state === 'error' || !rows ? (
        <Alert tone="error" className="mt-3">
          We couldn&apos;t load driver coverage right now. Please try again shortly.
        </Alert>
      ) : (
        <>
          {uncovered.length > 0 && (
            <Alert tone="warning" className="mt-3" title="Some districts have no approved driver">
              {uncovered.map((r) => DISTRICT_LABELS[r.district]).join(', ')} — door-to-door orders there
              will fail at booking until a driver approved for that district, or with it as a service
              area, exists.
            </Alert>
          )}

          <dl className="mt-3 grid gap-2 sm:grid-cols-2">
            {rows.map((r) => (
              <div
                key={r.district}
                className="flex items-center justify-between rounded-bmpl-md border border-slate-200 px-3 py-2"
              >
                <dt className="text-sm text-[color:var(--bmpl-text)]">{DISTRICT_LABELS[r.district]}</dt>
                <dd>
                  {r.approvedDrivers > 0 ? (
                    <Badge tone="success">
                      {r.approvedDrivers} approved driver{r.approvedDrivers === 1 ? '' : 's'}
                    </Badge>
                  ) : (
                    <Badge tone="warning">No approved driver</Badge>
                  )}
                </dd>
              </div>
            ))}
          </dl>
        </>
      )}
    </Card>
  );
}
