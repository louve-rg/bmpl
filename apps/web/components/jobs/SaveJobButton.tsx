'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { jobsApi } from '../../lib/jobs';
import type { ApiError } from '../../lib/api';

type Size = 'sm' | 'md' | 'lg';
const SIZE_PX: Record<Size, string> = { sm: 'h-4 w-4', md: 'h-5 w-5', lg: 'h-6 w-6' };
const BTN_PAD: Record<Size, string> = { sm: 'p-1.5', md: 'p-2', lg: 'p-2.5' };

/**
 * Heart toggle for jobs — safe to drop over server-rendered cards. Resolves its
 * saved state on mount (guests / 401 → not saved). Clicks are optimistic with
 * rollback on error; guests are routed to login with a return path.
 */
export function SaveJobButton({
  jobId,
  slug,
  size = 'md',
  className = '',
  initialSaved,
  withLabel = false,
}: {
  jobId: string;
  slug?: string;
  size?: Size;
  className?: string;
  initialSaved?: boolean;
  withLabel?: boolean;
}) {
  const router = useRouter();
  const [saved, setSaved] = useState<boolean>(initialSaved ?? false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (initialSaved !== undefined) return;
    let active = true;
    jobsApi
      .savedIds()
      .then((r) => active && setSaved(r.jobIds.includes(jobId)))
      .catch(() => {
        /* guests / errors: leave as not saved */
      });
    return () => {
      active = false;
    };
  }, [jobId, initialSaved]);

  async function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (busy) return;
    const next = !saved;
    setSaved(next);
    setBusy(true);
    try {
      if (next) await jobsApi.saveJob(jobId);
      else await jobsApi.unsaveJob(jobId);
    } catch (err) {
      setSaved(!next); // rollback
      if ((err as ApiError).status === 401) {
        router.push(`/login?next=${encodeURIComponent(slug ? `/jobs/${slug}` : '/jobs')}`);
      }
    } finally {
      setBusy(false);
    }
  }

  if (withLabel) {
    return (
      <button
        type="button"
        onClick={toggle}
        disabled={busy}
        aria-pressed={saved}
        className={`inline-flex items-center gap-2 rounded-lg border px-4 py-2.5 text-sm font-semibold transition ${
          saved
            ? 'border-belize-blue bg-belize-blue/5 text-belize-blue'
            : 'border-slate-300 text-belize-navy hover:border-belize-blue'
        } ${className}`}
      >
        <Heart filled={saved} className={SIZE_PX[size]} />
        {saved ? 'Saved' : 'Save job'}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={toggle}
      disabled={busy}
      aria-pressed={saved}
      aria-label={saved ? 'Remove from saved jobs' : 'Save job'}
      className={`inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-full text-belize-blue transition hover:bg-belize-blue/5 disabled:opacity-60 ${BTN_PAD[size]} ${className}`}
    >
      <Heart filled={saved} className={SIZE_PX[size]} />
    </button>
  );
}

function Heart({ filled, className }: { filled: boolean; className: string }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className={className}
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      aria-hidden
    >
      <path d="M12 21s-7.5-4.9-10-9.4C.6 8.7 2 5.3 5.2 5.3c2 0 3.3 1.2 4.8 3 1.5-1.8 2.8-3 4.8-3 3.2 0 4.6 3.4 3.2 6.3C19.5 16.1 12 21 12 21Z" />
    </svg>
  );
}
