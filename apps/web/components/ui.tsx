import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

const base =
  'inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent disabled:opacity-60 disabled:pointer-events-none';

const variants = {
  primary: 'bg-belize-blue text-white hover:bg-belize-deep',
  accent: 'bg-belize-accent text-white hover:brightness-110',
  outline: 'border border-belize-blue text-belize-blue hover:bg-belize-blue/5',
  ghostLight: 'text-white/90 hover:text-white',
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
