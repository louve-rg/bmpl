'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

type AnnouncementLevel = 'INFO' | 'WARNING' | 'CRITICAL';

interface AnnouncementView {
  announcement: { level: AnnouncementLevel; message: string } | null;
  maintenance: { message: string } | null;
}

// Per-level styling for the announcement strip.
const LEVEL_STYLES: Record<AnnouncementLevel, string> = {
  INFO: 'bg-belize-blue/10 text-belize-navy border-belize-blue/30',
  WARNING: 'bg-amber-50 text-amber-900 border-amber-300',
  CRITICAL: 'bg-red-50 text-red-900 border-red-300',
};

const DISMISS_KEY = 'bmpl:announcement-dismissed';

function InfoIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <circle cx="12" cy="12" r="10" />
      <path d="M12 16v-4M12 8h.01" />
    </svg>
  );
}

function WarningIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <path d="M12 9v4M12 17h.01" />
    </svg>
  );
}

function WrenchIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true" className="shrink-0">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18v3h3l6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-2.4 2.6-2.6z" />
    </svg>
  );
}

function LevelIcon({ level }: { level: AnnouncementLevel }) {
  return level === 'INFO' ? <InfoIcon /> : <WarningIcon />;
}

export function AnnouncementBanner() {
  const [data, setData] = useState<AnnouncementView | null>(null);
  // Track dismissed message strings so a NEW message re-shows.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());

  useEffect(() => {
    let active = true;
    api
      .get<AnnouncementView>('/marketplace/announcement')
      .then((d) => active && setData(d))
      .catch(() => active && setData(null));

    // Restore session-dismissed messages.
    try {
      const raw = sessionStorage.getItem(DISMISS_KEY);
      if (raw) setDismissed(new Set(JSON.parse(raw) as string[]));
    } catch {
      /* ignore storage errors */
    }

    return () => {
      active = false;
    };
  }, []);

  function dismiss(message: string) {
    setDismissed((prev) => {
      const next = new Set(prev);
      next.add(message);
      try {
        sessionStorage.setItem(DISMISS_KEY, JSON.stringify([...next]));
      } catch {
        /* ignore storage errors */
      }
      return next;
    });
  }

  if (!data) return null;

  const announcement = data.announcement && !dismissed.has(data.announcement.message) ? data.announcement : null;
  const maintenance = data.maintenance && !dismissed.has(data.maintenance.message) ? data.maintenance : null;

  if (!announcement && !maintenance) return null;

  return (
    <div role="status" aria-live="polite" className="w-full max-w-full">
      {maintenance && (
        <div className="border-b border-slate-300 bg-slate-100 text-slate-800">
          <div className="container-bmpl flex items-start gap-2 py-2 text-sm">
            <span className="mt-0.5 text-belize-blue">
              <WrenchIcon />
            </span>
            <p className="min-w-0 flex-1 break-words">{maintenance.message}</p>
            <button
              type="button"
              onClick={() => dismiss(maintenance.message)}
              aria-label="Dismiss maintenance notice"
              className="-mr-1 shrink-0 rounded-bmpl-md p-1 leading-none text-slate-500 transition hover:bg-slate-200 hover:text-slate-800"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {announcement && (
        <div className={`border-b ${LEVEL_STYLES[announcement.level]}`}>
          <div className="container-bmpl flex items-start gap-2 py-2 text-sm">
            <span className="mt-0.5">
              <LevelIcon level={announcement.level} />
            </span>
            <p className="min-w-0 flex-1 break-words font-medium">{announcement.message}</p>
            <button
              type="button"
              onClick={() => dismiss(announcement.message)}
              aria-label="Dismiss announcement"
              className="-mr-1 shrink-0 rounded-bmpl-md p-1 leading-none opacity-70 transition hover:bg-black/5 hover:opacity-100"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
                <path d="M6 6l12 12M6 18L18 6" />
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
