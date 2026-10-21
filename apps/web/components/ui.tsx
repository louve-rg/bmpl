import Link from 'next/link';
import type { ComponentProps, CSSProperties, ReactNode } from 'react';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent disabled:opacity-60 disabled:pointer-events-none';

const variants = {
  primary: 'bg-belize-blue text-white shadow-bmpl-sm hover:bg-belize-deep',
  accent: 'bg-belize-accent text-white shadow-bmpl-sm hover:brightness-110',
  outline: 'border border-[color:var(--bmpl-border)] text-[color:var(--bmpl-text)] hover:border-belize-blue hover:bg-belize-blue/5',
  ghost: 'text-[color:var(--bmpl-link)] hover:bg-belize-blue/5',
  ghostLight: 'text-white/90 hover:text-white',
  destructive: 'bg-red-600 text-white shadow-bmpl-sm hover:bg-red-700',
} as const;

const sizes = {
  sm: 'px-3 py-1.5 text-sm',
  md: 'px-5 py-2.5 text-sm',
  lg: 'px-7 py-3.5 text-base',
} as const;

type Variant = keyof typeof variants;
type Size = keyof typeof sizes;

export function ButtonLink({
  href,
  variant = 'primary',
  size = 'md',
  className = '',
  children,
}: {
  href: string;
  variant?: Variant;
  size?: Size;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...props
}: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  subtitle,
  dark = false,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: string;
  dark?: boolean;
}) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      {eyebrow && (
        <p className="mb-2 text-sm font-semibold uppercase tracking-wide text-belize-accent">
          {eyebrow}
        </p>
      )}
      <h2
        className={`text-3xl font-bold sm:text-4xl ${dark ? 'text-white' : 'text-belize-navy'}`}
      >
        {title}
      </h2>
      {subtitle && (
        <p className={`mt-3 text-lg ${dark ? 'text-blue-100' : 'text-slate-600'}`}>{subtitle}</p>
      )}
    </div>
  );
}

/** Small pill used to clearly mark not-yet-supplied content. */
export function PlaceholderBadge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-dashed border-slate-300 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-500">
      {children}
    </span>
  );
}

/* ------------------------------------------------------------------ surfaces */

/**
 * Elevated content surface (24px radius, hairline border, soft shadow).
 *
 * `title` is destructured out on purpose: `ComponentProps<'div'>` already
 * allows it (it's a valid, if pointless, HTML attribute), so TypeScript
 * cannot catch a caller passing it and expecting a heading — it would
 * otherwise silently reach the div as the native `title` attribute (a hover
 * tooltip) instead of rendering. Heading style matches the one already
 * hand-written at call sites that build their own Card heading, e.g.
 * `app/checkout/page.tsx`'s "Order summary".
 */
export function Card({ className = '', title, children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={`bmpl-card ${className}`} {...props}>
      {/* No explicit text color -- .bmpl-card already sets its own `color`
          from the active theme token (light-theme navy outside the glass
          scope, light text inside it). A hardcoded text-belize-navy here
          fought that and read as near-invisible dark-on-dark once a Card
          could render on the glass dashboard (confirmed on a real logged-in
          screenshot of /dashboard, not just reasoned about). */}
      {title && <h2 className="mb-3 text-lg font-semibold">{title}</h2>}
      {children}
    </div>
  );
}

/**
 * A form-grouping card: the FIXED on-light shell forms, maps and other dense
 * content need regardless of theme (see @bmpl/ui/glass.css's
 * --bmpl-oncolor-light-* -- req 6, contrast standard). Deliberately NOT
 * `.bmpl-card` -- that pairing is theme-ADAPTIVE and goes translucent/dark
 * under the glass dashboard, which is wrong here: the owner has ruled that
 * form fields, maps and other dense content stay an opaque, literal light
 * box in every theme, never glass.
 *
 * Renders a real `<fieldset>` so assistive tech still gets a named group
 * (`aria-label`), but the VISIBLE heading is an ordinary `<p>` inside the
 * padding -- never a native `<legend>`. A `<legend>`'s own UA rendering
 * straddles the fieldset's top border by design (how a browser draws any
 * fieldset/legend pair, not a bug in this codebase) -- which is exactly why
 * every card built that way visibly overlapped its own border. The `<p>` is
 * `aria-hidden` so the group name isn't announced twice.
 */
export function FormCard({
  legend,
  className = '',
  children,
  ...props
}: ComponentProps<'fieldset'> & { legend: string }) {
  return (
    <fieldset
      aria-label={legend}
      className={`bmpl-surface-onlight min-w-0 rounded-bmpl-xl border p-4 shadow-bmpl-sm sm:p-5 ${className}`}
      {...props}
    >
      <p className="mb-2 px-1 text-sm font-semibold" aria-hidden="true">
        {legend}
      </p>
      {children}
    </fieldset>
  );
}

/**
 * Moved to its own file (StickyActionBar.tsx) because the MDF-376 space-
 * reservation fix needs hooks (useRef/useEffect/useState), and this file
 * carries no 'use client' directive -- adding one here would force every
 * other export in ui.tsx into the client bundle too. Re-exported so every
 * existing `import { ..., StickyActionBar } from '.../ui'` keeps working.
 */
export { StickyActionBar } from './StickyActionBar';

/** Consistent page title block for authenticated screens. */
export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <p className="bmpl-eyebrow">{eyebrow}</p>}
        <h1 className="bmpl-page-title mt-1 break-words">{title}</h1>
        {description && <p className="mt-1.5 break-words text-sm text-[color:var(--bmpl-text-muted)]">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------- badges */

const TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  // `brand` was the one tone in this set built on an ALPHA background
  // (bg-belize-blue/10) rather than a solid pastel like every sibling here.
  // A solid tint composites to the same colour regardless of what's behind
  // it; a 10%-alpha tint composites toward whatever IS behind it -- near-
  // white on a light page (where this shipped and read fine), near-black
  // under the glass dashboard, where the badge measured 1.54-1.85:1
  // (owner-reported, admin "By revenue"). bg-blue-100/text-blue-800 is the
  // same solid-pastel recipe every other tone already uses, and blue-800 is
  // literally --bmpl-primary's own hex -- same brand colour, just no longer
  // see-through.
  brand: 'bg-blue-100 text-blue-800',
  success: 'bg-emerald-100 text-emerald-700',
  warning: 'bg-amber-100 text-amber-700',
  error: 'bg-red-100 text-red-700',
  info: 'bg-sky-100 text-sky-700',
} as const;

export type Tone = keyof typeof TONES;

export function Badge({ tone = 'neutral', className = '', children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${TONES[tone]} ${className}`}>
      {children}
    </span>
  );
}

/** Maps a domain status string to a branded, dot-prefixed badge. Status is never
 *  communicated by colour alone — the label text is always shown. */
const STATUS_TONE: Record<string, Tone> = {
  APPROVED: 'success', ACTIVE: 'success', PAID: 'success', AUTHORIZED: 'success', POSTED: 'success', RELEASED: 'success', DELIVERED: 'success', COMPLETED: 'success', PUBLISHED: 'success', BALANCED: 'success', PICKED_UP: 'success',
  PENDING: 'warning', PENDING_REVIEW: 'warning', MORE_INFO_REQUIRED: 'info', PROCESSING: 'info', PREPARING: 'info', HELD: 'info', RESERVED: 'info', READY_FOR_PICKUP: 'info',
  REJECTED: 'error', FAILED: 'error', CANCELLED: 'error', SUSPENDED: 'warning', UNBALANCED: 'error',
  DRAFT: 'neutral', REVOKED: 'neutral', WITHDRAWN: 'neutral', VOID: 'neutral', DEACTIVATED: 'neutral', ARCHIVED: 'neutral',
};
const DOT: Record<Tone, string> = {
  neutral: 'bg-slate-400', brand: 'bg-belize-blue', success: 'bg-emerald-500', warning: 'bg-amber-500', error: 'bg-red-500', info: 'bg-sky-500',
};

export function StatusBadge({ status, className = '' }: { status: string; className?: string }) {
  const tone = STATUS_TONE[status] ?? 'neutral';
  return (
    <Badge tone={tone} className={className}>
      <span className={`h-1.5 w-1.5 rounded-full ${DOT[tone]}`} aria-hidden />
      {status.replace(/_/g, ' ')}
    </Badge>
  );
}

/* -------------------------------------------------------------------- alerts */

const ALERT_STYLES: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  brand: 'border-blue-200 bg-blue-50 text-blue-800',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
};

export function Alert({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`rounded-bmpl-lg border px-4 py-3 text-sm ${ALERT_STYLES[tone]} ${className}`}>
      {title && <p className="break-words font-semibold">{title}</p>}
      {children && <div className={`break-words ${title ? 'mt-0.5' : ''}`}>{children}</div>}
    </div>
  );
}

/* -------------------------------------------------------------- empty + load */

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div
      data-theme="light"
      className="flex flex-col items-center justify-center rounded-bmpl-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center"
    >
      {icon && <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-bmpl-lg bg-slate-100 text-slate-400">{icon}</div>}
      <p className="text-base font-semibold text-belize-navy">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`animate-pulse rounded-bmpl-md bg-slate-200/70 ${className}`} aria-hidden />;
}

export function Spinner({ className = 'h-5 w-5' }: { className?: string }) {
  return (
    <svg className={`animate-spin text-belize-blue ${className}`} viewBox="0 0 24 24" fill="none" role="status" aria-label="Loading">
      <circle className="opacity-20" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-90" d="M12 2a10 10 0 0 1 10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

/* --------------------------------------------------------------------- forms */

/**
 * Accessible breadcrumb trail. The last item is the current page (not a link);
 * every earlier item links to a real ancestor level so "back" always follows the
 * content hierarchy and works for direct/shared links (no browser-history reliance).
 */
export function Breadcrumbs({
  items,
  className = '',
}: {
  items: Array<{ label: string; href?: string }>;
  className?: string;
}) {
  return (
    <nav aria-label="Breadcrumb" className={`text-sm ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex min-w-0 items-center gap-1.5">
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="min-w-0 break-words font-medium text-belize-blue hover:underline"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  className={`min-w-0 break-words ${last ? 'font-medium text-belize-navy' : ''}`}
                  aria-current={last ? 'page' : undefined}
                >
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-[color:var(--bmpl-text-muted-strong)]">
                  /
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

export function Label({ className = '', children, ...props }: ComponentProps<'label'>) {
  return (
    <label className={`bmpl-label ${className}`} {...props}>
      {children}
    </label>
  );
}

export function Input({ className = '', ...props }: ComponentProps<'input'>) {
  return <input className={`bmpl-input ${className}`} {...props} />;
}

export function Textarea({ className = '', ...props }: ComponentProps<'textarea'>) {
  return <textarea className={`bmpl-input ${className}`} {...props} />;
}

export function Select({ className = '', children, ...props }: ComponentProps<'select'>) {
  return (
    <select className={`bmpl-input ${className}`} {...props}>
      {children}
    </select>
  );
}

/**
 * Label + control + optional error/hint.
 *
 * Association: when the caller passes `htmlFor` (and sets a matching `id` on the
 * control) the label is wired explicitly. When `htmlFor` is omitted the control is
 * wrapped inside the `<label>` element so the association is IMPLICIT — this keeps
 * every `<Field>` accessible without requiring per-call ids, and stays a plain
 * (hook-free) server-compatible component. The error uses `role="alert"` so it is
 * announced when it appears.
 */
export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div>
      {htmlFor ? (
        <>
          <Label htmlFor={htmlFor}>{label}</Label>
          {children}
        </>
      ) : (
        <label className="block">
          <span className="bmpl-label">{label}</span>
          {children}
        </label>
      )}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
