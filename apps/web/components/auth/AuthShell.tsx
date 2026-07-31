import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup, Logo } from '../Logo';

export function AuthShell({
  title,
  subtitle,
  children,
  footer,
}: {
  title: string;
  subtitle?: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-gradient-to-br from-belize-navy via-[#0d2657] to-belize-blue p-12 lg:flex">
        <div
          className="pointer-events-none absolute inset-0 opacity-[0.35]"
          style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)', backgroundSize: '22px 22px' }}
          aria-hidden
        />
        <span className="pointer-events-none absolute -right-16 -top-20 h-72 w-72 rounded-full bg-belize-accent/25 blur-3xl" aria-hidden />

        <Link href="/" className="relative">
          <BrandLockup />
        </Link>
        <div className="relative">
          <h2 className="text-3xl font-bold leading-tight text-white">Your Complete Commerce Solution</h2>
          <p className="mt-3 max-w-md text-blue-100/80">
            One account for the marketplace, shipping, payments, and every service across all six
            districts of Belize.
          </p>
          <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-sm text-blue-100/70">
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-belize-accent" /> Secure &amp; reliable
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-belize-accent" /> Nationwide coverage
            </span>
            <span className="inline-flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-belize-accent" /> Local support
            </span>
          </div>
        </div>
        <p className="relative text-xs text-blue-200/60">© 2026 Belize Marketplace &amp; Logistics</p>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center bg-slate-50 p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Link href="/" className="inline-flex items-center gap-2.5">
              <Logo size={36} />
              <span className="text-base font-bold uppercase tracking-wide text-belize-navy">Belize Marketplace</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold tracking-tight text-belize-navy">{title}</h1>
          {subtitle && <p className="mt-2 text-sm text-slate-600">{subtitle}</p>}
          <div className="mt-6">{children}</div>
          {footer && <div className="mt-6 text-sm text-slate-600">{footer}</div>}
        </div>
      </div>
    </div>
  );
}

export function Field({
  label,
  name,
  type = 'text',
  autoComplete,
  required,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  autoComplete?: string;
  required?: boolean;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="bmpl-label">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="bmpl-input"
      />
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-bmpl-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-bmpl-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700" role="status">
      {message}
    </p>
  );
}
