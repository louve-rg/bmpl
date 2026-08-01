'use client';

import { useEffect, useState } from 'react';
import { api } from '../lib/api';

/* Public marketplace announcement/maintenance state. */
interface AnnouncementResponse {
  announcement: { level: 'INFO' | 'WARNING' | 'CRITICAL'; message: string } | null;
  maintenance: { message: string } | null;
}

const LEVEL_STYLES: Record<'INFO' | 'WARNING' | 'CRITICAL', string> = {
  INFO: 'bg-belize-blue text-white',
  WARNING: 'bg-amber-500 text-white',
  CRITICAL: 'bg-red-600 text-white',
};

export function AnnouncementBanner() {
  const [data, setData] = useState<AnnouncementResponse | null>(null);
  const [dismissedAnnouncement, setDismissedAnnouncement] = useState(false);
  const [dismissedMaintenance, setDismissedMaintenance] = useState(false);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const d = await api.get<AnnouncementResponse>('/marketplace/announcement');
        if (active) setData(d);
      } catch {
        /* Banner is best-effort — never block the shell on failure. */
      }
    })();
    return () => {
      active = false;
    };
  }, []);

  if (!data) return null;

  const showAnnouncement = data.announcement && !dismissedAnnouncement;
  const showMaintenance = data.maintenance && !dismissedMaintenance;
  if (!showAnnouncement && !showMaintenance) return null;

  return (
    <div>
      {showAnnouncement && data.announcement && (
        <div className={`flex items-start gap-3 px-4 py-2.5 text-sm font-medium md:px-8 ${LEVEL_STYLES[data.announcement.level]}`} role="status">
          <span className="mt-px inline-flex shrink-0 items-center rounded-full bg-white/20 px-2 py-0.5 text-xs font-bold uppercase tracking-wide">
            {data.announcement.level}
          </span>
          <span className="flex-1">{data.announcement.message}</span>
          <button
            type="button"
            onClick={() => setDismissedAnnouncement(true)}
            aria-label="Dismiss announcement"
            className="shrink-0 rounded p-0.5 text-white/80 transition hover:bg-white/20 hover:text-white"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
      {showMaintenance && data.maintenance && (
        <div className="flex items-start gap-3 border-b border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-medium text-sky-800 md:px-8" role="status">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="mt-px h-4 w-4 shrink-0" aria-hidden>
            <path d="M14.7 6.3a4 4 0 0 1-5.4 5.4L4 17v3h3l5.3-5.3a4 4 0 0 1 5.4-5.4l-2.5 2.5-2-2 2.5-2.5Z" />
          </svg>
          <span className="flex-1">
            <span className="font-semibold">Maintenance:</span> {data.maintenance.message}
          </span>
          <button
            type="button"
            onClick={() => setDismissedMaintenance(true)}
            aria-label="Dismiss maintenance notice"
            className="shrink-0 rounded p-0.5 text-sky-700/70 transition hover:bg-sky-100 hover:text-sky-900"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" className="h-4 w-4" aria-hidden>
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
