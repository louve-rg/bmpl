import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '../Logo';

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
      <div className="relative hidden flex-col justify-between bg-belize-hero p-12 lg:flex">
        <Link href="/">
          <BrandLockup />
        </Link>
        <div>
          <h2 className="text-3xl font-bold text-white">Your Complete Commerce Solution</h2>
          <p className="mt-3 max-w-md text-blue-100">
            One account for marketplace, shipping, passenger service, employment, real estate,
            marketing, and your platform wallet.
          </p>
        </div>
        <p className="text-sm text-blue-200">Made in Belize 🇧🇿</p>
      </div>

      <div className="flex items-center justify-center p-6 sm:p-12">
        <div className="w-full max-w-md">
          <div className="mb-8 lg:hidden">
            <Link href="/">
              <span className="text-lg font-bold text-belize-blue">Belize Marketplace</span>
            </Link>
          </div>
          <h1 className="text-2xl font-bold text-belize-navy">{title}</h1>
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
      <span className="mb-1 block text-sm font-medium text-slate-700">{label}</span>
      <input
        name={name}
        type={type}
        autoComplete={autoComplete}
        required={required}
        placeholder={placeholder}
        className="w-full rounded-lg border border-slate-300 px-3 py-2.5 text-sm outline-none transition focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30"
      />
    </label>
  );
}

export function FormError({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
      {message}
    </p>
  );
}

export function FormSuccess({ message }: { message?: string | null }) {
  if (!message) return null;
  return (
    <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-700" role="status">
      {message}
    </p>
  );
}
