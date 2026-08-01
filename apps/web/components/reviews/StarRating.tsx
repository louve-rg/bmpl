'use client';

import { useId, useState } from 'react';

type Size = 'sm' | 'md' | 'lg';

const SIZE_PX: Record<Size, string> = {
  sm: 'h-3.5 w-3.5',
  md: 'h-4 w-4',
  lg: 'h-6 w-6',
};

const TEXT_SIZE: Record<Size, string> = {
  sm: 'text-xs',
  md: 'text-sm',
  lg: 'text-base',
};

/** A single star drawn at a fill level (0 = empty, 0.5 = half, 1 = full). */
function Star({ fill, className }: { fill: number; className: string }) {
  const clipId = useId();
  const pct = Math.round(Math.max(0, Math.min(1, fill)) * 100);
  const path =
    'M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.3l-5.8 3.06 1.1-6.46-4.69-4.58 6.49-.94L12 2.5Z';
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <defs>
        <clipPath id={clipId}>
          <rect x="0" y="0" width={`${pct}%`} height="100%" />
        </clipPath>
      </defs>
      <path d={path} className="fill-slate-200" />
      <path d={path} className="fill-amber-400" clipPath={`url(#${clipId})`} />
    </svg>
  );
}

/**
 * Presentational star rating. Supports half-star display for averages, a size
 * prop, and an optional count shown alongside.
 */
export function StarRating({
  value,
  size = 'md',
  count,
  showValue = false,
  className = '',
}: {
  value: number;
  size?: Size;
  count?: number;
  showValue?: boolean;
  className?: string;
}) {
  const label =
    count != null
      ? `Rated ${value.toFixed(1)} out of 5 from ${count} review${count === 1 ? '' : 's'}`
      : `Rated ${value.toFixed(1)} out of 5`;
  return (
    <span className={`inline-flex items-center gap-1.5 ${className}`} role="img" aria-label={label}>
      <span className="inline-flex items-center gap-0.5" aria-hidden>
        {[0, 1, 2, 3, 4].map((i) => (
          <Star key={i} fill={value - i} className={SIZE_PX[size]} />
        ))}
      </span>
      {showValue && <span className={`font-semibold text-belize-navy ${TEXT_SIZE[size]}`}>{value.toFixed(1)}</span>}
      {count != null && (
        <span className={`text-slate-500 ${TEXT_SIZE[size]}`} aria-hidden>
          {count > 0 ? `(${count})` : 'No reviews yet'}
        </span>
      )}
    </span>
  );
}

/**
 * Controlled 1–5 star picker for forms. Keyboard accessible via a radiogroup:
 * arrow keys move the selection, each star has an aria-label.
 */
export function StarInput({
  value,
  onChange,
  size = 'lg',
  disabled = false,
  id,
}: {
  value: number;
  onChange: (v: number) => void;
  size?: Size;
  disabled?: boolean;
  id?: string;
}) {
  const [hover, setHover] = useState<number | null>(null);
  const shown = hover ?? value;

  function onKeyDown(e: React.KeyboardEvent, star: number) {
    if (disabled) return;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      onChange(Math.min(5, star + 1));
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      onChange(Math.max(1, star - 1));
    } else if (e.key === ' ' || e.key === 'Enter') {
      e.preventDefault();
      onChange(star);
    }
  }

  return (
    <div
      id={id}
      role="radiogroup"
      aria-label="Select a rating from 1 to 5 stars"
      className="inline-flex items-center gap-1"
      onMouseLeave={() => setHover(null)}
    >
      {[1, 2, 3, 4, 5].map((star) => {
        const active = star <= shown;
        return (
          <button
            key={star}
            type="button"
            role="radio"
            aria-checked={value === star}
            aria-label={`${star} star${star === 1 ? '' : 's'}`}
            tabIndex={disabled ? -1 : value === star || (value === 0 && star === 1) ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(star)}
            onMouseEnter={() => setHover(star)}
            onKeyDown={(e) => onKeyDown(e, star)}
            className="rounded p-0.5 transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent disabled:cursor-not-allowed disabled:opacity-60"
          >
            <Star fill={active ? 1 : 0} className={SIZE_PX[size]} />
          </button>
        );
      })}
    </div>
  );
}
