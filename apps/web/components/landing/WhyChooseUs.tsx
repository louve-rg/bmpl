import type { ReactNode } from 'react';

/**
 * "Why choose us" — a dark, enterprise-feeling band that bridges the light
 * Platform section above and the white Providers section below (curved dividers
 * top and bottom). Three glass panels, each a distinct premium treatment: an
 * illuminated shield, a minimalist Belize district map, and a live activity
 * feed. Interactions are pure CSS on hover (lift / border glow / icon scale).
 */

const PANEL =
  'group relative flex flex-col overflow-hidden rounded-[24px] border border-white/10 bg-white/[0.04] p-7 backdrop-blur-sm transition duration-300 ease-out hover:-translate-y-1.5 hover:border-belize-light/40 hover:bg-white/[0.06] hover:shadow-[0_40px_80px_-40px_rgba(20,80,180,0.55)] sm:p-8';

function PanelTopline() {
  return (
    <span className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-belize-light/50 to-transparent" aria-hidden />
  );
}

export function WhyChooseUs() {
  return (
    <section className="relative overflow-hidden bg-belize-navy pb-36 pt-28 sm:pt-32">
      {/* Curved lead-in from the light Platform section above. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 leading-[0]" aria-hidden>
        <svg viewBox="0 0 1440 60" preserveAspectRatio="none" className="block h-[36px] w-full sm:h-[48px]">
          <path d="M0 0 L1440 0 L1440 18 C1080 52 360 52 0 18 Z" fill="#f8fafc" />
        </svg>
      </div>

      {/* Ambient blue lighting */}
      <div className="pointer-events-none absolute left-1/2 top-24 h-96 w-[42rem] -translate-x-1/2 rounded-full bg-belize-accent/10 blur-[120px]" aria-hidden />

      <div className="relative mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8">
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-light">Why Choose Us</p>
          <h2 className="mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl lg:text-[2.75rem]">
            Built on trust.
            <br /> Designed for Belize.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-blue-100/80 sm:text-lg">
            Built with enterprise-grade security, nationwide infrastructure, and a platform engineered
            to connect every service in one ecosystem.
          </p>
        </div>

        <div className="mt-14 grid gap-5 sm:mt-16 md:grid-cols-3">
          <SecurePanel />
          <CoveragePanel />
          <UpdatesPanel />
        </div>
      </div>

      {/* Curved divider into the white Providers section below. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 leading-[0]" aria-hidden>
        <svg viewBox="0 0 1440 90" preserveAspectRatio="none" className="block h-[48px] w-full sm:h-[70px]">
          <path d="M0 0 C420 84 1020 84 1440 0 L1440 90 L0 90 Z" fill="#ffffff" />
        </svg>
      </div>
    </section>
  );
}

/* --------------------------------------------------------------- helpers */

function PanelHeading({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <h3 className="mt-6 text-lg font-bold text-white">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-blue-100/70">{children}</p>
    </>
  );
}

/* ------------------------------------------------------------ Secure panel */

function SecurePanel() {
  return (
    <article className={PANEL}>
      <PanelTopline />
      <div className="pointer-events-none absolute -right-16 -top-16 h-40 w-40 rounded-full bg-belize-accent/15 blur-3xl" aria-hidden />
      <div className="relative">
        <span
          className="relative flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-belize-blue/40 to-belize-accent/20 ring-1 ring-inset ring-white/15 transition-transform duration-300 group-hover:scale-105"
          aria-hidden
        >
          <span className="absolute inset-0 rounded-2xl bg-belize-accent/20 blur-md" />
          <svg viewBox="0 0 24 24" fill="none" className="relative h-8 w-8 text-belize-light">
            <path d="M12 3 5 6v5.5c0 4 3 7.4 7 8.5 4-1.1 7-4.5 7-8.5V6l-7-3Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
            <path d="m9 12 2 2 4-4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
      </div>
      <PanelHeading title="Secure & Reliable">
        Enterprise-grade security with encrypted transactions, verified identities, secure
        authentication, and audited platform activity.
      </PanelHeading>
    </article>
  );
}

/* ---------------------------------------------------------- Coverage panel */

const DISTRICTS: Array<{ name: string; x: number; y: number }> = [
  { name: 'Corozal', x: 62, y: 16 },
  { name: 'Orange Walk', x: 50, y: 40 },
  { name: 'Belize', x: 70, y: 58 },
  { name: 'Cayo', x: 40, y: 66 },
  { name: 'Stann Creek', x: 60, y: 90 },
  { name: 'Toledo', x: 48, y: 116 },
];

function CoveragePanel() {
  return (
    <article className={PANEL}>
      <PanelTopline />
      <div className="pointer-events-none absolute -left-16 -top-10 h-40 w-40 rounded-full bg-belize-blue/20 blur-3xl" aria-hidden />
      <div className="relative flex justify-center py-2" aria-hidden>
        <div className="relative h-40 w-40">
          <span className="absolute inset-0 rounded-full bg-belize-accent/10 blur-2xl" />
          <svg viewBox="0 0 100 132" className="relative h-full w-full">
            <defs>
              <linearGradient id="bz-land" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0" stopColor="#1d4ed8" stopOpacity="0.45" />
                <stop offset="1" stopColor="#0ea5e9" stopOpacity="0.25" />
              </linearGradient>
            </defs>
            {/* stylized Belize landmass */}
            <path
              d="M34 8 66 12 72 30 68 46 74 64 70 86 60 110 48 126 40 108 44 84 36 64 42 44 32 26 Z"
              fill="url(#bz-land)"
              stroke="#7dd3fc"
              strokeOpacity="0.6"
              strokeWidth="1.2"
              strokeLinejoin="round"
            />
            {/* connection paths */}
            {DISTRICTS.slice(1).map((d, i) => {
              const p = DISTRICTS[i]!;
              return (
                <line key={d.name} x1={p.x} y1={p.y} x2={d.x} y2={d.y} stroke="#7dd3fc" strokeOpacity="0.35" strokeWidth="1" strokeDasharray="1 4" strokeLinecap="round" />
              );
            })}
            {/* district markers with micro glow */}
            {DISTRICTS.map((d) => (
              <g key={d.name} className="transition-opacity">
                <circle cx={d.x} cy={d.y} r="5.5" fill="#38bdf8" opacity="0.18" />
                <circle cx={d.x} cy={d.y} r="2.6" fill="#e0f2fe" stroke="#38bdf8" strokeWidth="1.2" />
              </g>
            ))}
          </svg>
        </div>
      </div>
      <PanelHeading title="Nationwide Coverage">
        Connecting businesses and customers across all six districts of Belize from one unified
        platform.
      </PanelHeading>
    </article>
  );
}

/* ----------------------------------------------------------- Updates panel */

const FEED: Array<{ tone: string; time: string; title: string; sub: string; icon: ReactNode }> = [
  {
    tone: 'bg-emerald-500/15 text-emerald-300',
    time: '2m',
    title: 'Order approved',
    sub: 'Order #BZ-1042',
    icon: <path d="m5 12 4 4 10-10" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  },
  {
    tone: 'bg-sky-500/15 text-sky-300',
    time: '5m',
    title: 'Driver assigned',
    sub: 'Arriving in 15 min',
    icon: <><path d="M3 7h11v9H3z" stroke="currentColor" strokeWidth="1.6" /><path d="M14 10h4l3 3v3h-7" stroke="currentColor" strokeWidth="1.6" /><circle cx="7" cy="17.5" r="1.4" stroke="currentColor" strokeWidth="1.6" /><circle cx="17.5" cy="17.5" r="1.4" stroke="currentColor" strokeWidth="1.6" /></>,
  },
  {
    tone: 'bg-violet-500/15 text-violet-300',
    time: '12m',
    title: 'Property inquiry',
    sub: '3 Bed Villa · Belize City',
    icon: <><path d="M4 11 12 5l8 6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /><path d="M6 10v9h12v-9" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></>,
  },
  {
    tone: 'bg-teal-500/15 text-teal-300',
    time: '1h',
    title: 'Wallet payment received',
    sub: '+BZ$450.00',
    icon: <><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" /></>,
  },
];

function UpdatesPanel() {
  return (
    <article className={PANEL}>
      <PanelTopline />
      <div className="pointer-events-none absolute -right-16 -bottom-16 h-40 w-40 rounded-full bg-belize-accent/10 blur-3xl" aria-hidden />
      <div className="relative space-y-2" aria-hidden>
        <div className="mb-3 flex items-center justify-between">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-blue-100/60">Activity</span>
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-emerald-300">
            <span className="relative flex h-1.5 w-1.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400/70" />
              <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
            </span>
            Live
          </span>
        </div>
        {FEED.map((f) => (
          <div key={f.title} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.05] px-3 py-2 transition duration-300 group-hover:border-white/20">
            <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${f.tone}`}>
              <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{f.icon}</svg>
            </span>
            <div className="min-w-0 flex-1">
              <p className="truncate text-[12px] font-semibold text-white">{f.title}</p>
              <p className="truncate text-[10px] text-blue-100/60">{f.sub}</p>
            </div>
            <span className="shrink-0 text-[10px] text-blue-100/50">{f.time}</span>
          </div>
        ))}
      </div>
      <PanelHeading title="Real-time Updates">
        Receive instant updates for orders, bookings, applications, deliveries, and platform activity.
      </PanelHeading>
    </article>
  );
}
