'use client';

import { useState, type ReactNode } from 'react';
import type { ApiError } from '../../lib/api';

/* Money helpers — the API speaks integer cents; the UI speaks dollars. */
export const centsToDollars = (c: number | null): string => (c == null ? '' : (c / 100).toFixed(2));
export const dollarsToCents = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
};
export const money = (c: number | null): string => (c == null ? '—' : `$${(c / 100).toFixed(2)}`);

/** Normalize an unknown throw into an ApiError-ish shape. */
export function asApiError(e: unknown): ApiError {
  const err = e as ApiError;
  return {
    status: err?.status ?? 0,
    message: err?.message ?? 'Something went wrong.',
    errors: err?.errors,
  };
}

/** Pull a field-specific message out of ApiError.errors, else fall back to the top-level message. */
export function fieldError(e: ApiError, ...paths: string[]): string {
  const hit = e.errors?.find((x) => paths.some((p) => x.path === p || x.path.endsWith(`.${p}`)));
  return hit?.message ?? e.message;
}

/* Compact control classes that match the design-system inputs at a smaller scale. */
export const smallInput =
  'rounded-bmpl-md border border-slate-300 bg-white px-2.5 py-1.5 text-sm text-belize-navy outline-none transition placeholder:text-slate-400 focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:opacity-70';
export const tinyInput =
  'rounded-bmpl-sm border border-slate-200 bg-white px-2 py-1 text-xs text-belize-navy outline-none transition placeholder:text-slate-400 focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30';

/**
 * Inline, two-step confirmation affordance (no window.confirm). The trigger
 * arms an inline "Confirm / Cancel" pair. An optional `note` renders above the
 * buttons — used to surface a 409 message and offer a forced retry.
 */
export function ConfirmAction({
  label,
  confirmLabel = 'Confirm',
  onConfirm,
  className = '',
  note,
  tone = 'danger',
}: {
  label: ReactNode;
  confirmLabel?: string;
  onConfirm: () => void | Promise<void>;
  className?: string;
  note?: ReactNode;
  tone?: 'danger' | 'neutral';
}) {
  const [armed, setArmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const triggerColor = tone === 'danger' ? 'text-red-600' : 'text-slate-500';

  if (!armed) {
    return (
      <button
        type="button"
        onClick={() => setArmed(true)}
        className={`text-xs font-semibold ${triggerColor} hover:underline ${className}`}
      >
        {label}
      </button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      {note && <span className="text-xs text-amber-700">{note}</span>}
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          try {
            await onConfirm();
          } finally {
            setBusy(false);
            setArmed(false);
          }
        }}
        className="rounded-bmpl-sm bg-red-600 px-2 py-0.5 text-xs font-semibold text-white transition hover:bg-red-700 disabled:opacity-50"
      >
        {busy ? '…' : confirmLabel}
      </button>
      <button
        type="button"
        disabled={busy}
        onClick={() => setArmed(false)}
        className="text-xs font-semibold text-slate-500 hover:underline"
      >
        Cancel
      </button>
    </span>
  );
}

/** Tiny "Saving… / Saved" indicator used next to per-field save actions. */
export function SaveState({ state }: { state: 'idle' | 'saving' | 'saved' | 'error' }) {
  if (state === 'saving') return <span className="text-xs text-slate-400">Saving…</span>;
  if (state === 'saved') return <span className="text-xs text-emerald-600">Saved</span>;
  return null;
}
