import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Platform Wallet — a realistic wallet dashboard (left) paired with the value
 * proposition and product feature rows (right). The dashboard is built from
 * markup + SVG (no raster assets) so it stays crisp and cheap to render.
 */

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
    {children}
  </svg>
);

const FEATURES: Array<{ title: string; desc: string; icon: ReactNode }> = [
  { title: 'Customer Payments', desc: 'Seamless checkout across every service.', icon: svg(<><rect x="3" y="6" width="18" height="12" rx="2" /><path d="M3 10h18" /></>) },
  { title: 'Vendor Earnings', desc: 'Fast, transparent payouts.', icon: svg(<><path d="M12 19V5" /><path d="m6 11 6-6 6 6" /></>) },
  { title: 'Escrow Protection', desc: 'Funds held safely until delivery.', icon: svg(<><path d="M12 3 5 6v5.5c0 4 3 7.4 7 8.5 4-1.1 7-4.5 7-8.5V6l-7-3Z" /><path d="m9 12 2 2 4-4" /></>) },
  { title: 'Transfers', desc: 'Move money in seconds.', icon: svg(<><path d="M4 8h13m0 0-3-3m3 3-3 3" /><path d="M20 16H7m0 0 3-3m-3 3 3 3" /></>) },
  { title: 'Withdrawals', desc: 'Cash out straight to your bank.', icon: svg(<><path d="M4 10h16M6 10V7l6-3 6 3v3M6 10v7m5-7v7m4-7v7M4 20h16" /></>) },
  { title: 'Secure Ledger', desc: 'Every entry auditable.', icon: svg(<><rect x="4" y="3" width="16" height="18" rx="2" /><path d="M8 8h8M8 12h8M8 16h5" /></>) },
];

export function WalletSection() {
  return (
    <section id="wallet" className="bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto grid w-full max-w-[1200px] items-center gap-10 px-4 sm:px-6 lg:grid-cols-2 lg:gap-16 lg:px-8">
        {/* Dashboard */}
        <div className="order-2 lg:order-1">
          <WalletDashboard />
        </div>

        {/* Copy */}
        <div className="order-1 lg:order-2">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-accent">Platform Wallet</p>
          <h2 className="mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-belize-navy sm:text-4xl">
            One secure wallet.
            <br /> Every transaction.
          </h2>
          <p className="mt-4 max-w-lg text-base leading-relaxed text-slate-600">
            Pay vendors, receive earnings, manage escrow, transfer funds, and track every transaction
            from one secure balance built into the platform.
          </p>

          <dl className="mt-8 grid gap-x-6 gap-y-5 sm:grid-cols-2">
            {FEATURES.map((f) => (
              <div key={f.title} className="flex items-start gap-3">
                <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-belize-blue/10 text-belize-blue" aria-hidden>
                  {f.icon}
                </span>
                <div>
                  <dt className="text-sm font-semibold text-belize-navy">{f.title}</dt>
                  <dd className="text-xs leading-relaxed text-slate-500">{f.desc}</dd>
                </div>
              </div>
            ))}
          </dl>

          <Link
            href="/register"
            className="group mt-8 inline-flex items-center gap-1.5 text-sm font-semibold text-belize-blue focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
          >
            Learn more
            <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 transition-transform duration-300 group-hover:translate-x-1">
              <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------- dashboard */

const ACTIONS: Array<{ label: string; icon: ReactNode }> = [
  { label: 'Send', icon: <path d="M4 12 20 5l-6 15-3-6-7-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /> },
  { label: 'Request', icon: <path d="M12 5v14m0 0-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /> },
  { label: 'Top up', icon: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" /> },
  { label: 'QR', icon: <><rect x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><path d="M14 14h3v3m3 0v3h-6v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></> },
];

const TXNS: Array<{ label: string; sub: string; amount: string; positive?: boolean; icon: ReactNode }> = [
  { label: 'Sunrise Grocers', sub: 'Today · 9:41 AM', amount: '−BZ$84.50', icon: <><path d="M4 8h16l-1 3H5L4 8Z" stroke="currentColor" strokeWidth="1.5" /><path d="M5 11v8h14v-8" stroke="currentColor" strokeWidth="1.5" /></> },
  { label: 'Delivery earnings', sub: 'Today · 8:12 AM', amount: '+BZ$32.00', positive: true, icon: <><path d="M3 7h11v9H3z" stroke="currentColor" strokeWidth="1.5" /><path d="M14 10h4l3 3v3h-7" stroke="currentColor" strokeWidth="1.5" /></> },
  { label: 'Wallet top-up', sub: 'Yesterday', amount: '+BZ$500.00', positive: true, icon: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /> },
];

function WalletDashboard() {
  return (
    <div className="relative mx-auto w-full max-w-md rounded-[24px] border border-slate-200 bg-white p-4 shadow-[0_30px_70px_-40px_rgba(15,23,42,0.4)] sm:p-5">
      {/* Balance card */}
      <div className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-belize-navy via-[#123a7a] to-belize-blue p-5 text-white">
        <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/15 blur-2xl" aria-hidden />
        <div className="relative flex items-center justify-between">
          <span className="text-xs font-medium uppercase tracking-wide text-white/70">BML Wallet</span>
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 text-white/70" aria-hidden><path d="M6 8a8 8 0 0 1 0 8M9.5 6a12 12 0 0 1 0 12M13 4a16 16 0 0 1 0 16" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>
        </div>
        <p className="relative mt-4 text-[11px] text-white/60">Available balance</p>
        <p className="relative text-3xl font-bold tracking-tight">BZ$1,250.00</p>
        <div className="relative mt-5 flex items-center justify-between">
          <span className="font-mono text-sm tracking-widest text-white/80">•••• •••• •••• 4821</span>
          <span className="text-xs font-semibold text-white/70">BZD</span>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mt-4 grid grid-cols-4 gap-2">
        {ACTIONS.map((a) => (
          <div key={a.label} className="flex flex-col items-center gap-1.5 rounded-xl border border-slate-100 bg-slate-50 py-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-belize-blue/10 text-belize-blue" aria-hidden>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{a.icon}</svg>
            </span>
            <span className="text-[10px] font-medium text-slate-600">{a.label}</span>
          </div>
        ))}
      </div>

      {/* Recent activity */}
      <div className="mt-4">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-belize-navy">Recent activity</span>
          <span className="text-[11px] font-semibold text-belize-blue">View all</span>
        </div>
        <div className="space-y-1.5">
          {TXNS.map((t) => (
            <div key={t.label} className="flex items-center gap-3 rounded-xl border border-slate-100 px-3 py-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-100 text-slate-500" aria-hidden>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{t.icon}</svg>
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-belize-navy">{t.label}</p>
                <p className="truncate text-[10px] text-slate-400">{t.sub}</p>
              </div>
              <span className={`shrink-0 text-[12px] font-bold ${t.positive ? 'text-emerald-600' : 'text-slate-700'}`}>{t.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
