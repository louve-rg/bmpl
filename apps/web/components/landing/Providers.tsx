import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * "For businesses & providers" — an onboarding-style role selector plus a
 * horizontal CTA panel. The selector uses native radio inputs styled with
 * Tailwind `peer-checked`, so it is a real, keyboard-navigable single-select
 * (arrow keys + space) with a genuine selected state and zero client JS.
 */

const ROLES: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Vendor', icon: <><path d="M4 8h16l-1 3H5L4 8Z" strokeWidth="1.6" /><path d="M5 11v8h14v-8" strokeWidth="1.6" /><path d="M9 19v-4h6v4" strokeWidth="1.6" /></> },
  { label: 'Delivery Driver', icon: <><path d="M3 7h11v9H3z" strokeWidth="1.6" /><path d="M14 10h4l3 3v3h-7" strokeWidth="1.6" /><circle cx="7" cy="17.5" r="1.5" strokeWidth="1.6" /><circle cx="17.5" cy="17.5" r="1.5" strokeWidth="1.6" /></> },
  { label: 'Shipping Provider', icon: <><path d="M4 14l1.5 5h13L20 14" strokeWidth="1.6" /><path d="M6 14V8h9l3 3v3" strokeWidth="1.6" /><path d="M12 5v3" strokeWidth="1.6" /></> },
  { label: 'Passenger Driver', icon: <><rect x="5" y="4" width="14" height="13" rx="2.5" strokeWidth="1.6" /><path d="M5 12h14" strokeWidth="1.6" /><path d="M8 20v-3M16 20v-3" strokeWidth="1.6" /><circle cx="8.5" cy="14.5" r="0.6" /><circle cx="15.5" cy="14.5" r="0.6" /></> },
  { label: 'Employer', icon: <><rect x="3" y="7" width="18" height="12" rx="2" strokeWidth="1.6" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" strokeWidth="1.6" /><path d="M3 12h18" strokeWidth="1.6" /></> },
  { label: 'Real Estate Agent', icon: <><path d="M4 11 12 5l8 6" strokeWidth="1.6" /><path d="M6 10v9h12v-9" strokeWidth="1.6" /></> },
  { label: 'Property Owner', icon: <><path d="M5 20V6l7-2 7 2v14" strokeWidth="1.6" /><path d="M3 20h18" strokeWidth="1.6" /><path d="M9 9h1M14 9h1M9 13h1M14 13h1" strokeWidth="1.6" strokeLinecap="round" /></> },
  { label: 'Marketing Client', icon: <><path d="M4 10v4h4l6 4V6l-6 4H4Z" strokeWidth="1.6" /><path d="M18 9a3 3 0 0 1 0 6" strokeWidth="1.6" /></> },
];

export function Providers() {
  return (
    <section id="providers" className="bg-white py-20 sm:py-28">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-accent">
            For Businesses &amp; Providers
          </p>
          <h2 className="mt-3 text-3xl font-bold leading-[1.12] tracking-tight text-belize-navy sm:text-4xl lg:text-[2.75rem]">
            Grow your business.
            <br />
            One account. <span className="text-belize-blue">Unlimited opportunities.</span>
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            Create one account and unlock every business opportunity on the platform. Apply for the
            services you need and expand as your business grows.
          </p>
        </div>

        {/* Role selector */}
        <fieldset className="mx-auto mt-12 max-w-3xl">
          <legend className="sr-only">Choose the provider role you want to explore</legend>
          <div className="flex flex-wrap justify-center gap-2.5 sm:gap-3">
            {ROLES.map((role, i) => (
              <label key={role.label} className="relative cursor-pointer">
                <input
                  type="radio"
                  name="provider-role"
                  value={role.label}
                  defaultChecked={i === 0}
                  className="peer sr-only"
                />
                <span className="flex items-center gap-2.5 rounded-full border border-slate-200 bg-white py-2.5 pl-3 pr-4 text-sm font-medium text-slate-600 shadow-sm transition duration-300 ease-out hover:-translate-y-0.5 hover:border-belize-light hover:shadow-md peer-checked:border-belize-blue peer-checked:bg-belize-blue/[0.06] peer-checked:text-belize-blue peer-checked:shadow-[0_12px_26px_-14px_rgba(30,64,175,0.55)] peer-checked:[&>span]:bg-belize-blue peer-checked:[&>span]:text-white peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-belize-accent">
                  <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-slate-100 text-slate-500 transition-colors duration-300" aria-hidden>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      {role.icon}
                    </svg>
                  </span>
                  {role.label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {/* CTA panel */}
        <div className="relative mt-14 overflow-hidden rounded-[24px] bg-gradient-to-br from-belize-navy via-[#0d2657] to-[#0a1c42] p-8 shadow-[0_40px_80px_-40px_rgba(10,23,60,0.6)] sm:mt-16 sm:p-10">
          {/* subtle dot pattern */}
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{ backgroundImage: 'radial-gradient(rgba(255,255,255,0.10) 1px, transparent 1px)', backgroundSize: '20px 20px' }}
            aria-hidden
          />
          {/* glass highlights */}
          <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />
          <span className="pointer-events-none absolute -right-16 -top-20 h-56 w-56 rounded-full bg-belize-accent/25 blur-3xl" aria-hidden />

          <div className="relative flex flex-col items-start gap-6 md:flex-row md:items-center md:justify-between md:gap-10">
            <div className="max-w-xl">
              <h3 className="text-xl font-bold leading-snug text-white sm:text-2xl">
                Ready to join Belize&apos;s fastest-growing digital ecosystem?
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-blue-100/80 sm:text-base">
                Start with one role today and expand your business whenever you&apos;re ready.
              </p>
            </div>
            <Link
              href="/register"
              className="group inline-flex shrink-0 items-center gap-2 rounded-2xl bg-gradient-to-r from-belize-accent to-belize-blue px-7 py-4 text-base font-semibold text-white shadow-lg shadow-belize-accent/25 transition duration-300 hover:shadow-xl hover:shadow-belize-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
            >
              Become a Provider
              <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-5 w-5 transition-transform duration-300 group-hover:translate-x-1">
                <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </Link>
          </div>
        </div>
      </div>
    </section>
  );
}
