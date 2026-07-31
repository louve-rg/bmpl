import type { ReactNode } from 'react';

/**
 * Mobile app showcase — copy + store badges (left) and an angled phone mockup
 * running the BMPL app UI, ringed by subtle floating activity cards (right).
 * Everything is markup/SVG; floating cards are hidden on small screens to avoid
 * awkward overlap.
 */

function AppleBadge() {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-2.5 text-white">
      <svg viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6" aria-hidden>
        <path d="M16.2 12.9c0-2.1 1.7-3.1 1.8-3.2-1-1.4-2.5-1.6-3-1.7-1.3-.1-2.5.8-3.1.8-.6 0-1.6-.7-2.7-.7-1.4 0-2.7.8-3.4 2.1-1.5 2.5-.4 6.3 1 8.4.7 1 1.5 2.1 2.6 2.1 1 0 1.4-.7 2.7-.7 1.2 0 1.6.7 2.7.6 1.1 0 1.8-1 2.5-2 .8-1.1 1.1-2.2 1.1-2.3-.1 0-2.2-.8-2.2-3.3Z" />
        <path d="M14.5 6.6c.6-.7 1-1.7.9-2.6-.9 0-1.9.6-2.5 1.3-.5.6-1 1.6-.9 2.5.9.1 1.9-.5 2.5-1.2Z" />
      </svg>
      <span className="text-left leading-none">
        <span className="block text-[9px] text-white/70">Download on the</span>
        <span className="block text-sm font-semibold">App Store</span>
      </span>
    </span>
  );
}

function GoogleBadge() {
  return (
    <span className="inline-flex items-center gap-2.5 rounded-xl bg-slate-900 px-4 py-2.5 text-white">
      <svg viewBox="0 0 24 24" className="h-6 w-6" aria-hidden>
        <path d="M4 3.3v17.4l9.3-8.7L4 3.3Z" fill="#34d399" />
        <path d="m13.3 12 3-2.8-9.9-5.6 6.9 8.4Z" fill="#60a5fa" />
        <path d="m13.3 12 6.9 8.4 3-5.6-9.9-2.8Z" fill="#f87171" />
        <path d="m16.3 9.2 3.9 5.6 2.4-1.4c1.1-.7 1.1-2 0-2.6l-2.4-1.4-3.9-.2Z" fill="#fbbf24" />
      </svg>
      <span className="text-left leading-none">
        <span className="block text-[9px] text-white/70">Get it on</span>
        <span className="block text-sm font-semibold">Google Play</span>
      </span>
    </span>
  );
}

const QUICK: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Shop', icon: <path d="M4 8h16l-1 3H5L4 8Zm1 3v8h14v-8" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /> },
  { label: 'Ship', icon: <><path d="M3 7h11v9H3z" stroke="currentColor" strokeWidth="1.5" /><path d="M14 10h4l3 3v3h-7" stroke="currentColor" strokeWidth="1.5" /></> },
  { label: 'Travel', icon: <path d="M4 14l16-6-6 16-2-6-8-4Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /> },
  { label: 'Jobs', icon: <><rect x="3" y="7" width="18" height="12" rx="2" stroke="currentColor" strokeWidth="1.5" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" stroke="currentColor" strokeWidth="1.5" /></> },
  { label: 'More', icon: <><circle cx="6" cy="12" r="1.3" fill="currentColor" /><circle cx="12" cy="12" r="1.3" fill="currentColor" /><circle cx="18" cy="12" r="1.3" fill="currentColor" /></> },
];

function FloatCard({ className, tone, icon, title, sub }: { className: string; tone: string; icon: ReactNode; title: string; sub: string }) {
  return (
    <div className={`absolute z-20 hidden items-center gap-2.5 rounded-2xl border border-slate-200/80 bg-white/90 px-3.5 py-2.5 shadow-[0_20px_40px_-20px_rgba(15,23,42,0.35)] backdrop-blur lg:flex ${className}`} aria-hidden>
      <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${tone}`}>
        <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{icon}</svg>
      </span>
      <div>
        <p className="text-[11px] font-semibold text-belize-navy">{title}</p>
        <p className="text-[10px] text-slate-400">{sub}</p>
      </div>
    </div>
  );
}

export function MobilePromo() {
  return (
    <section id="mobile" className="overflow-hidden bg-white py-20 sm:py-28">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:gap-8 lg:px-8">
        {/* Copy */}
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-accent">Mobile App</p>
          <h2 className="mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-belize-navy sm:text-4xl">
            Belize Marketplace,
            <br /> in your pocket.
          </h2>
          <p className="mt-4 max-w-md text-base leading-relaxed text-slate-600">
            Manage orders, deliveries, bookings, wallet transactions, and provider roles from
            anywhere.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-3">
            <AppleBadge />
            <GoogleBadge />
            <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-xs font-medium text-slate-500">
              <span className="h-1.5 w-1.5 rounded-full bg-belize-accent" /> Coming soon
            </span>
          </div>
        </div>

        {/* Phone */}
        <div className="relative flex justify-center py-6 lg:justify-end lg:py-10">
          <FloatCard className="-left-2 top-6 xl:-left-6" tone="bg-emerald-500/15 text-emerald-600" title="Order Delivered" sub="Order #BMPL-7821" icon={<path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />} />
          <FloatCard className="-right-2 top-28 xl:-right-4" tone="bg-teal-500/15 text-teal-600" title="Wallet Payment" sub="+BZ$450.00" icon={<><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" /></>} />
          <FloatCard className="-left-4 bottom-24" tone="bg-sky-500/15 text-sky-600" title="Driver Assigned" sub="Arriving in 15 min" icon={<><path d="M3 7h11v9H3z" stroke="currentColor" strokeWidth="1.6" /><path d="M14 10h4l3 3v3h-7" stroke="currentColor" strokeWidth="1.6" /></>} />
          <FloatCard className="-right-3 bottom-10" tone="bg-violet-500/15 text-violet-600" title="New Customer" sub="Just placed an order" icon={<><circle cx="12" cy="8" r="3.2" stroke="currentColor" strokeWidth="1.6" /><path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>} />

          <PhoneMock />
        </div>
      </div>
    </section>
  );
}

function PhoneMock() {
  return (
    <div className="relative w-[248px] shrink-0 rounded-[2.6rem] border-[10px] border-slate-900 bg-slate-900 shadow-[0_40px_80px_-30px_rgba(15,23,42,0.55)] sm:w-[272px] lg:rotate-[3deg]">
      <span className="absolute left-1/2 top-0 z-10 h-5 w-24 -translate-x-1/2 rounded-b-2xl bg-slate-900" aria-hidden />
      <div className="overflow-hidden rounded-[1.9rem] bg-gradient-to-b from-belize-blue/[0.06] via-white to-white" aria-hidden>
        {/* status bar */}
        <div className="flex items-center justify-between px-5 pb-1 pt-3 text-[10px] font-semibold text-belize-navy">
          <span>9:41</span>
          <span className="flex items-center gap-1">
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M2 17h3v4H2zM7 12h3v9H7zM12 8h3v13h-3zM17 4h3v17h-3z" /></svg>
            <svg viewBox="0 0 24 24" className="h-3 w-3" fill="currentColor"><path d="M12 4C7 4 3 7 2 9l10 11L22 9c-1-2-5-5-10-5Z" /></svg>
          </span>
        </div>
        {/* greeting */}
        <div className="px-5 pt-3">
          <p className="text-[11px] text-slate-400">Good morning,</p>
          <p className="text-lg font-bold text-belize-navy">John 👋</p>
        </div>
        {/* quick actions */}
        <div className="mt-4 px-4">
          <div className="grid grid-cols-5 gap-1">
            {QUICK.map((q) => (
              <div key={q.label} className="flex flex-col items-center gap-1">
                <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-belize-blue/10 text-belize-blue">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{q.icon}</svg>
                </span>
                <span className="text-[8px] font-medium text-slate-500">{q.label}</span>
              </div>
            ))}
          </div>
        </div>
        {/* recent activity */}
        <div className="mt-4 px-4">
          <p className="mb-2 text-[10px] font-semibold text-belize-navy">Recent activity</p>
          <div className="space-y-1.5">
            <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-belize-blue/10 text-belize-blue">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M4 8h16l-1 3H5L4 8Z" stroke="currentColor" strokeWidth="1.6" /><path d="M5 11v8h14v-8" stroke="currentColor" strokeWidth="1.6" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-belize-navy">Order #BMPL-7821</p>
                <p className="text-[8px] text-slate-400">Today · 9:41 AM</p>
              </div>
              <span className="rounded-full bg-emerald-100 px-1.5 py-0.5 text-[8px] font-semibold text-emerald-700">Delivered</span>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-slate-100 bg-white px-2.5 py-2">
              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-teal-500/15 text-teal-600">
                <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" /></svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[10px] font-semibold text-belize-navy">Wallet top-up</p>
                <p className="text-[8px] text-slate-400">Yesterday</p>
              </div>
              <span className="text-[10px] font-bold text-emerald-600">+BZ$500</span>
            </div>
          </div>
        </div>
        <div className="h-6" />
      </div>
    </div>
  );
}
