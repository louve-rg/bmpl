import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

/**
 * BMPL shared UI primitives (admin). Kept token-identical to
 * apps/web/components/ui.tsx so both surfaces render one brand. Consolidating
 * these into a single @bmpl/ui React package is the recommended follow-up (see
 * docs/design/BMPL-THEME-AUDIT.md — deferred to avoid changing the live build
 * pipeline mid-milestone).
 */

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent disabled:opacity-60 disabled:pointer-events-none';

const variants = {
  primary: 'bg-belize-blue text-white shadow-bmpl-sm hover:bg-belize-deep',
  accent: 'bg-belize-accent text-white shadow-bmpl-sm hover:brightness-110',
  outline: 'border border-slate-300 text-belize-navy hover:border-belize-blue hover:bg-belize-blue/5',
  ghost: 'text-belize-blue hover:bg-belize-blue/5',
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

export function ButtonLink({ href, variant = 'primary', size = 'md', className = '', children }: { href: string; variant?: Variant; size?: Size; className?: string; children: ReactNode }) {
  return (
    <Link href={href} className={`${base} ${variants[variant]} ${sizes[size]} ${className}`}>
      {children}
    </Link>
  );
}

export function Button({ variant = 'primary', size = 'md', className = '', children, ...props }: ComponentProps<'button'> & { variant?: Variant; size?: Size }) {
  return (
    <button className={`${base} ${variants[variant]} ${sizes[size]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Card({ className = '', children, ...props }: ComponentProps<'div'>) {
  return (
    <div className={`bmpl-card ${className}`} {...props}>
      {children}
    </div>
  );
}

export type Crumb = { label: string; href?: string };

/**
 * Accessible admin breadcrumb trail. Last item is the current page (not a link,
 * `aria-current="page"`); earlier items link to real ancestor routes so the trail
 * matches the URL hierarchy and works for direct/shared deep links (no history reliance).
 */
export function Breadcrumbs({ items, className = '' }: { items: Crumb[]; className?: string }) {
  return (
    <nav aria-label="Breadcrumb" className={`text-sm ${className}`}>
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        {items.map((item, i) => {
          const last = i === items.length - 1;
          return (
            <li key={`${item.label}-${i}`} className="flex items-center gap-1.5">
              {item.href && !last ? (
                <Link href={item.href} className="font-medium text-belize-blue hover:underline">
                  {item.label}
                </Link>
              ) : (
                <span className={last ? 'font-medium text-belize-navy' : ''} aria-current={last ? 'page' : undefined}>
                  {item.label}
                </span>
              )}
              {!last && (
                <span aria-hidden="true" className="text-slate-300">
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

export function PageHeader({
  title,
  description,
  eyebrow,
  actions,
  breadcrumbs,
}: {
  title: string;
  description?: string;
  eyebrow?: string;
  actions?: ReactNode;
  breadcrumbs?: Crumb[];
}) {
  return (
    <div className="mb-6">
      {breadcrumbs && breadcrumbs.length > 0 && <Breadcrumbs items={breadcrumbs} className="mb-3" />}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          {eyebrow && <p className="bmpl-eyebrow">{eyebrow}</p>}
          <h1 className="bmpl-page-title mt-1">{title}</h1>
          {description && <p className="mt-1.5 text-sm text-slate-500">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

const TONES = {
  neutral: 'bg-slate-100 text-slate-600',
  brand: 'bg-belize-blue/10 text-belize-blue',
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

const ALERT_STYLES: Record<Tone, string> = {
  neutral: 'border-slate-200 bg-slate-50 text-slate-700',
  brand: 'border-belize-light/50 bg-belize-blue/5 text-belize-navy',
  success: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  warning: 'border-amber-200 bg-amber-50 text-amber-800',
  error: 'border-red-200 bg-red-50 text-red-700',
  info: 'border-sky-200 bg-sky-50 text-sky-800',
};

export function Alert({ tone = 'info', title, children, className = '' }: { tone?: Tone; title?: string; children?: ReactNode; className?: string }) {
  return (
    <div role="alert" className={`rounded-bmpl-lg border px-4 py-3 text-sm ${ALERT_STYLES[tone]} ${className}`}>
      {title && <p className="font-semibold">{title}</p>}
      {children && <div className={title ? 'mt-0.5' : ''}>{children}</div>}
    </div>
  );
}

export function EmptyState({ icon, title, description, action }: { icon?: ReactNode; title: string; description?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-bmpl-xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
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

export function Field({ label, htmlFor, error, hint, children }: { label: string; htmlFor?: string; error?: string | null; hint?: string; children: ReactNode }) {
  return (
    <div>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && (
        <p className="mt-1 text-xs font-medium text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
