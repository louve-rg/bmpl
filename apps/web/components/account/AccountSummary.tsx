'use client';

import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { walletApi, type WalletSummary } from '../../lib/wallet';
import {
  EARNINGS_ROW_CAP,
  EMPLOYER_JOB_CAP,
  SEEKER_APPLICATION_CAP,
  moneyLabel,
  netSince,
  startOfToday,
  startOfWeek,
  type MoneyRow,
} from '../../lib/account-summary';

/**
 * One line in a summary box. `value` null means "Not available" (a failed call
 * or a list cut off too early to total). `muted` marks a non-applicable line.
 */
type Line = { label: string; sublabel: string; value: string | null; muted?: boolean };
type Box = { heading: string; lines: Line[] };

const NOT_APPLICABLE = 'Not applicable';

/**
 * The Jobs, Earnings and Wallet boxes inside the account menu. The rules each
 * line follows are in lib/account-summary.ts.
 *
 * Loaded only when the menu is open, so a page that never opens it makes no
 * extra calls. A failed call shows "Not available" on its own line and never
 * becomes a 0 or hides the other lines.
 */
export function AccountSummary({ me, tone }: { me: MeView; tone: 'dark' | 'light' }) {
  const [boxes, setBoxes] = useState<Box[] | null>(null);

  useEffect(() => {
    let active = true;
    const approved = me.roles.filter((r) => r.status === 'APPROVED').map((r) => r.roleCode);
    const isDriver = approved.includes('DELIVERY_DRIVER');
    const isVendor = approved.includes('VENDOR');
    const isSeeker = approved.includes('JOB_SEEKER');
    const isEmployer = approved.includes('EMPLOYER');

    async function load() {
      const now = new Date();
      const today = startOfToday(now);
      const week = startOfWeek(now);

      // Each source is fetched once; a failure stays local to the lines it feeds.
      const driverRows = isDriver
        ? await api.get<{ earnings: MoneyRow[] }>('/driver/earnings').then((d) => d.earnings).catch(() => null)
        : null;
      const vendorRows = isVendor
        ? await api.get<{ settlements: MoneyRow[] }>('/vendor/settlements').then((d) => d.settlements).catch(() => null)
        : null;
      const seekerRows = isSeeker
        ? await api.get<unknown[]>('/job-seeker/applications').then((d) => d).catch(() => null)
        : null;
      const employerRows = isEmployer
        ? await api.get<unknown[]>('/employer/jobs').then((d) => d).catch(() => null)
        : null;
      const w = await walletApi.summary().catch(() => null);

      const jobLines: Line[] = [];
      if (isDriver) jobLines.push(countLine('Deliveries', 'driver deliveries', driverRows, EARNINGS_ROW_CAP));
      if (isSeeker) jobLines.push(countLine('Applications', 'job applications you have sent', seekerRows, SEEKER_APPLICATION_CAP));
      if (isEmployer) jobLines.push(countLine('Listings', 'job listings you have posted', employerRows, EMPLOYER_JOB_CAP));
      if (jobLines.length === 0) jobLines.push(notApplicable('no job role on this account'));

      const earnLines: Line[] = [];
      if (isDriver) earnLines.push(...windowLines('Delivery earnings', 'net, from your deliveries', driverRows, EARNINGS_ROW_CAP, today, week));
      if (isVendor) earnLines.push(...windowLines('Vendor sales', 'net of commission, from your settlements', vendorRows, EARNINGS_ROW_CAP, today, week));
      if (earnLines.length === 0) earnLines.push(notApplicable('no earning role on this account'));

      const next: Box[] = [
        { heading: 'Jobs', lines: jobLines },
        { heading: 'Earnings', lines: earnLines },
        { heading: 'Wallet', lines: [walletLine(w)] },
      ];
      if (active) setBoxes(next);
    }
    void load();
    return () => {
      active = false;
    };
    // `me` does not change while the menu is open; the role flags are read once.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const muted = tone === 'dark' ? 'text-blue-100/60' : 'text-slate-500';
  const strong = tone === 'dark' ? 'text-white' : 'text-belize-navy';

  return (
    <div className={`mb-2 border-b pb-2 ${tone === 'dark' ? 'border-white/10' : 'border-slate-100'}`} aria-busy={boxes === null}>
      {boxes === null ? (
        <p className={`px-3 py-2 text-xs ${muted}`}>Loading…</p>
      ) : (
        boxes.map((box) => (
          <div key={box.heading} className="px-3 py-1">
            <p className={`text-[11px] font-semibold uppercase tracking-[0.12em] ${tone === 'dark' ? 'text-belize-light' : 'text-slate-500'}`}>
              {box.heading}
            </p>
            {box.lines.map((l, i) => (
              <p key={`${box.heading}-${i}`} className={`text-sm ${l.muted ? `italic ${muted}` : strong}`}>
                {l.muted ? (
                  <span className="font-medium">{l.label}</span>
                ) : l.value === null ? (
                  <span className="font-medium">{`${l.label}: Not available`}</span>
                ) : (
                  <>
                    <span className="font-medium">{l.value}</span> <span className={muted}>{l.label}</span>
                  </>
                )}
                <span className={`block text-xs ${muted}`}>{l.sublabel}</span>
              </p>
            ))}
          </div>
        ))
      )}
    </div>
  );
}

function countLine(label: string, sublabel: string, rows: unknown[] | null, cap: number): Line {
  if (!rows) return { label, sublabel, value: null };
  const note = rows.length >= cap ? ` (newest ${cap} counted)` : '';
  return { label, sublabel: `${sublabel}${note}`, value: String(rows.length) };
}

function windowLines(label: string, sublabel: string, rows: MoneyRow[] | null, cap: number, today: Date, week: Date): Line[] {
  const t = rows ? netSince(rows, today, cap) : null;
  const w = rows ? netSince(rows, week, cap) : null;
  return [
    { label: `${label} today`, sublabel, value: t ? moneyLabel(t.minor, t.currency) : null },
    { label: `${label} this week`, sublabel, value: w ? moneyLabel(w.minor, w.currency) : null },
  ];
}

function notApplicable(sublabel: string): Line {
  return { label: NOT_APPLICABLE, sublabel, value: null, muted: true };
}

function walletLine(w: WalletSummary | null): Line {
  if (!w) return { label: 'Wallet', sublabel: 'your BML wallet', value: null };
  if (!w.exists) return { label: 'No wallet yet', sublabel: 'your BML wallet', value: null, muted: true };
  return { label: 'available', sublabel: 'your BML wallet', value: moneyLabel(w.availableMinor, w.currency) };
}
