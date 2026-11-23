'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api } from '../lib/api';

/**
 * S2-ANNOUNCE: the static "Coming February 2027" strip lives in THIS file,
 * not a second banner component. god's own review caught it: a second
 * site-wide strip component would have been a second implementation of
 * something that already works (CLAUDE.md s12), and this file already was
 * the platform's one slim-strip-above-content convention (Header.tsx mounts
 * it directly above its own `sticky top-0` header, non-sticky, same shape a
 * first draft of the launch bar independently arrived at before this
 * correction landed).
 *
 * Genuinely different from the dynamic maintenance/announcement blocks
 * below, which is why it is its own always-rendered block rather than a
 * third AnnouncementLevel value threaded through the same data shape:
 *   - Static and hardcoded, not server-driven -- there is nothing to fetch,
 *     and a launch date is a 3-month product commitment, not an
 *     admin-editable ops notice that should be one accidental API edit away
 *     from disappearing.
 *   - Never dismissed. The owner wants this "communicated prominently";
 *     folding it into DISMISS_KEY's sessionStorage set would let a visitor
 *     make it vanish for the rest of their session, which the dynamic
 *     messages are explicitly designed to allow and this one is not.
 *   - Outside the `role="status" aria-live="polite"` wrapper below on
 *     purpose -- that region exists so a screen reader announces a NEW ops
 *     message landing; this block never changes after mount, so it has
 *     nothing to announce and sits outside the live region instead of
 *     inside it making a false claim.
 *
 * MOUNT POINT MOVED (same commit): this component used to be mounted only
 * inside Header.tsx, which only renders on public marketing pages --
 * `/dashboard/*` has its own separate header and never imported it. The
 * "site-wide, including the authenticated app" requirement cannot be met
 * from that mount point no matter what this component renders, so the
 * render call moved to the root layout (`app/layout.tsx`, first in <body>)
 * and was removed from Header.tsx. Side effect, named rather than
 * discovered later: the dynamic maintenance/announcement strip now also
 * reaches /login, /register and every authenticated dashboard page, which
 * it did not before -- an improvement for an ops notice, but a real change
 * in this existing component's visibility footprint, flagged in the PR.
 */
function LaunchStrip() {
  return (
    <div className="w-full bg-belize-navy text-white" style={{ paddingTop: 'max(0.4rem, env(safe-area-inset-top))' }}>
      <div className="container-bmpl flex items-center justify-center gap-2 py-1.5 text-center text-xs font-medium sm:text-sm">
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 text-belize-light">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>
          Coming February 2027 —
          <Link href="/#launch" className="ml-1 underline decoration-belize-light/50 underline-offset-2 hover:text-belize-light">
            learn more
          </Link>
        </span>
      </div>
    </div>
  );
}

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

  const announcement = data?.announcement && !dismissed.has(data.announcement.message) ? data.announcement : null;
  const maintenance = data?.maintenance && !dismissed.has(data.maintenance.message) ? data.maintenance : null;

  return (
    <>
      <LaunchStrip />
      {(announcement || maintenance) && (
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
      )}
    </>
  );
}
