import Link from 'next/link';
import type { ReactNode } from 'react';

/**
 * Platform showcase — a bento layout where each cell is a miniature, realistic
 * product interface (built entirely from markup + SVG, no raster assets) rather
 * than a generic feature card. Marketplace is the dominant cell; the remaining
 * verticals fan out around it. Only the per-card CTA is interactive (a stretched
 * link makes the whole card clickable); every preview graphic is decorative and
 * hidden from assistive tech.
 */

/* ---------------------------------------------------------------- primitives */

function ArrowIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4 transition-transform duration-300 ease-out group-hover:translate-x-1">
      <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Stretched CTA: covers the whole (relatively-positioned) card via ::after. */
function Cta({ href, children, className = 'text-belize-blue' }: { href: string; children: ReactNode; className?: string }) {
  return (
    <Link
      href={href}
      className={`mt-5 inline-flex w-fit items-center gap-1.5 rounded text-sm font-semibold ${className} after:absolute after:inset-0 after:content-[''] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent`}
    >
      {children}
      <ArrowIcon />
    </Link>
  );
}

const CARD =
  'group relative flex flex-col overflow-hidden rounded-[24px] border border-slate-200/80 bg-white p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_30px_-18px_rgba(15,23,42,0.18)] transition duration-300 ease-out hover:-translate-y-1 hover:border-belize-light/70 hover:shadow-[0_1px_2px_rgba(15,23,42,0.06),0_28px_50px_-24px_rgba(30,64,175,0.28)] sm:p-6';

function Badge({ tone, children }: { tone: string; children: ReactNode }) {
  return (
    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${tone}`} aria-hidden>
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- icon glyphs */

const ico = (path: ReactNode, vb = '0 0 24 24') => (
  <svg aria-hidden viewBox={vb} fill="none" className="h-5 w-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
    {path}
  </svg>
);

const BagIcon = ico(<><path d="M6 8h12l-1 11H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></>);
const TruckIcon = ico(<><path d="M3 7h11v9H3z" /><path d="M14 10h4l3 3v3h-7" /><circle cx="7" cy="18" r="1.6" /><circle cx="17.5" cy="18" r="1.6" /></>);
const VanIcon = ico(<><path d="M3 8h9l4 3h4v5H3z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /><path d="M12 8v3" /></>);
const BriefcaseIcon = ico(<><rect x="3" y="7" width="18" height="12" rx="2" /><path d="M8 7V5.5A1.5 1.5 0 0 1 9.5 4h5A1.5 1.5 0 0 1 16 5.5V7" /><path d="M3 12h18" /></>);
const HomeIcon = ico(<><path d="M4 11 12 5l8 6" /><path d="M6 10v9h12v-9" /></>);
const ChartIcon = ico(<><path d="M4 19V5" /><path d="M4 19h16" /><path d="M8 16l3-4 3 2 4-6" /></>);
const WalletIcon = ico(<><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M16 12h2" /><path d="M3 9h13a2 2 0 0 1 2 2" /></>);

/* ---------------------------------------------------------------- section */

export function Services() {
  return (
    <section id="services" aria-labelledby="platform-heading" className="relative bg-slate-50 py-20 sm:py-28">
      <div className="mx-auto w-full max-w-[1200px] px-4 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="mx-auto max-w-2xl text-center">
          <p className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-accent">Our Platform</p>
          <h2 id="platform-heading" className="mt-3 text-3xl font-bold leading-[1.1] tracking-tight text-belize-navy sm:text-4xl lg:text-[2.75rem]">
            Everything Belize needs,
            <br className="hidden sm:block" /> in one platform.
          </h2>
          <p className="mx-auto mt-4 max-w-xl text-base leading-relaxed text-slate-600 sm:text-lg">
            One secure ecosystem for shopping, shipping, transportation, employment, real estate,
            marketing, and digital payments.
          </p>
        </div>

        {/* Bento */}
        <div className="mt-14 space-y-4 sm:mt-16 sm:space-y-5">
          <div className="grid gap-4 sm:gap-5 lg:grid-cols-12">
            <div className="lg:col-span-7">
              <MarketplaceCard />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:col-span-5 lg:grid-cols-1">
              <ShippingCard />
              <PassengerCard />
            </div>
          </div>

          <div className="grid gap-4 sm:grid-cols-2 sm:gap-5 lg:grid-cols-12">
            <div className="lg:col-span-5">
              <BelizeConnectCard />
            </div>
            <div className="lg:col-span-7">
              <RealEstateCard />
            </div>
            <div className="lg:col-span-5">
              <MarketingCard />
            </div>
            <div className="lg:col-span-7">
              <WalletCard />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ============================================================== Marketplace */

const PRODUCTS = [
  { name: 'Wireless Headphones', vendor: 'TechHub BZ', price: 'BZ$120.00', glyph: <><path d="M6 14v-2a6 6 0 0 1 12 0v2" /><rect x="4" y="14" width="3.5" height="6" rx="1.6" /><rect x="16.5" y="14" width="3.5" height="6" rx="1.6" /></> },
  { name: 'Handmade Soap', vendor: 'Belize Naturals', price: 'BZ$18.00', glyph: <><path d="M12 4c-3 2-4.5 4.8-4.5 7.5a4.5 4.5 0 0 0 9 0C16.5 9 15 6.5 12 4Z" /></> },
  { name: 'Natural Honey', vendor: 'Cayo Apiary', price: 'BZ$25.00', glyph: <><path d="M8 8V6h8v2" /><rect x="7" y="8" width="10" height="12" rx="2" /><path d="M12 12v4" /></> },
  { name: 'Woven Tote Bag', vendor: 'Toledo Crafts', price: 'BZ$45.00', glyph: <><path d="M6 8h12l-1 12H7L6 8Z" /><path d="M9 8a3 3 0 0 1 6 0" /></> },
];

const CATS = [
  { label: 'All', g: <><rect x="4" y="4" width="6" height="6" rx="1.4" /><rect x="14" y="4" width="6" height="6" rx="1.4" /><rect x="4" y="14" width="6" height="6" rx="1.4" /><rect x="14" y="14" width="6" height="6" rx="1.4" /></> },
  { label: 'Electronics', g: <><rect x="3" y="5" width="18" height="11" rx="2" /><path d="M8 20h8" /><path d="M12 16v4" /></> },
  { label: 'Fashion', g: <><path d="M8 4 5 7l2 2v11h10V9l2-2-3-3-2 2h-4L8 4Z" /></> },
  { label: 'Home', g: <><path d="M4 11 12 5l8 6" /><path d="M6 10v9h12v-9" /></> },
  { label: 'Beauty', g: <><path d="m12 3 1.6 4.9L18.5 9l-4.9 1.6L12 15l-1.6-4.4L5.5 9l4.9-1.1L12 3Z" /></> },
  { label: 'More', g: <><circle cx="6" cy="12" r="1.4" /><circle cx="12" cy="12" r="1.4" /><circle cx="18" cy="12" r="1.4" /></> },
];

function MarketplaceCard() {
  return (
    <article className="group relative flex h-full flex-col overflow-hidden rounded-[24px] border border-white/10 bg-gradient-to-br from-[#0b204a] via-belize-navy to-[#0a1732] p-6 shadow-[0_20px_60px_-30px_rgba(10,23,60,0.9)] transition duration-300 ease-out hover:-translate-y-1 hover:shadow-[0_30px_70px_-32px_rgba(14,60,150,0.7)] sm:p-8">
      <div className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-belize-accent/25 blur-3xl" aria-hidden />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-white/25 to-transparent" aria-hidden />

      <div className="relative flex items-start gap-3">
        <Badge tone="bg-belize-accent/15 text-belize-light">{BagIcon}</Badge>
        <div>
          <h3 className="text-xl font-bold text-white sm:text-2xl">Marketplace</h3>
          <p className="mt-1 max-w-md text-sm text-blue-100/80">
            Shop from verified Belizean businesses. Support local. Buy nationwide.
          </p>
        </div>
      </div>

      {/* Embedded storefront preview */}
      <div className="relative mt-6 rounded-2xl border border-white/10 bg-white p-3.5 shadow-2xl sm:p-4" aria-hidden>
        <div className="flex items-center gap-2">
          <div className="flex flex-1 items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <svg viewBox="0 0 20 20" fill="none" className="h-4 w-4 text-slate-400"><circle cx="9" cy="9" r="6" stroke="currentColor" strokeWidth="1.6" /><path d="m14 14 3 3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>
            <span className="text-xs text-slate-400">Search products, stores…</span>
          </div>
          <span className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500">
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4"><path d="M5 7h14l-1.2 8.5a2 2 0 0 1-2 1.7H8.2a2 2 0 0 1-2-1.7L5 7Z" stroke="currentColor" strokeWidth="1.6" /><path d="M8.5 7a3.5 3.5 0 1 1 7 0" stroke="currentColor" strokeWidth="1.6" /></svg>
            <span className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full bg-belize-accent text-[9px] font-bold text-white">3</span>
          </span>
        </div>

        <div className="mt-3 flex justify-between gap-1">
          {CATS.map((c, i) => (
            <div key={c.label} className="flex flex-1 flex-col items-center gap-1">
              <span className={`flex h-9 w-9 items-center justify-center rounded-lg ${i === 0 ? 'bg-belize-blue/10 text-belize-blue' : 'bg-slate-100 text-slate-500'}`}>
                <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">{c.g}</svg>
              </span>
              <span className="truncate text-[9px] font-medium text-slate-500">{c.label}</span>
            </div>
          ))}
        </div>

        <div className="mt-3 flex items-center justify-between">
          <span className="text-xs font-semibold text-belize-navy">Popular products</span>
          <span className="text-[11px] font-semibold text-belize-blue">View all</span>
        </div>

        <div className="mt-2 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {PRODUCTS.map((p) => (
            <div key={p.name} className="rounded-xl border border-slate-100 bg-white p-2 transition duration-300 group-hover:border-slate-200">
              <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-gradient-to-br from-slate-100 to-slate-200/70">
                <svg viewBox="0 0 24 24" fill="none" className="h-7 w-7 text-slate-400 transition-transform duration-500 group-hover:scale-110" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">{p.glyph}</svg>
                <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-white/90 text-slate-400 shadow-sm">
                  <svg viewBox="0 0 24 24" fill="none" className="h-3 w-3"><path d="M12 20s-6.5-4.3-8.5-8A4 4 0 0 1 12 6.5 4 4 0 0 1 20.5 12c-2 3.7-8.5 8-8.5 8Z" stroke="currentColor" strokeWidth="1.8" /></svg>
                </span>
              </div>
              <p className="mt-1.5 truncate text-[11px] font-semibold text-belize-navy">{p.name}</p>
              <p className="truncate text-[9px] text-slate-400">{p.vendor}</p>
              <p className="mt-0.5 text-[11px] font-bold text-belize-blue">{p.price}</p>
            </div>
          ))}
        </div>
      </div>

      <Cta href="/products" className="text-white">Explore Marketplace</Cta>
    </article>
  );
}

/* ================================================================= Shipping */

function ShippingCard() {
  return (
    <article className={`${CARD} min-h-[210px]`}>
      <div className="flex items-start gap-3">
        <Badge tone="bg-sky-500/10 text-sky-600">{TruckIcon}</Badge>
        <div>
          <h3 className="text-base font-bold text-belize-navy">Shipping &amp; Delivery</h3>
          <p className="mt-0.5 text-sm text-slate-500">Land, air &amp; sea, every district.</p>
        </div>
      </div>

      <div className="relative mt-4 flex-1 overflow-hidden rounded-2xl bg-gradient-to-br from-sky-50 to-white" aria-hidden>
        <svg viewBox="0 0 260 130" className="h-full w-full" preserveAspectRatio="xMidYMid slice">
          <defs>
            <pattern id="ship-grid" width="26" height="26" patternUnits="userSpaceOnUse">
              <path d="M26 0H0V26" fill="none" stroke="#e2e8f0" strokeWidth="1" />
            </pattern>
          </defs>
          <rect width="260" height="130" fill="url(#ship-grid)" />
          <path d="M150 8c14 6 20 20 16 38-3 14 8 20 6 34-2 16-20 22-40 20-16-2-24-14-22-30 2-14-6-22-2-38 4-14 28-20 42-24Z" fill="#e0f2fe" stroke="#bae6fd" strokeWidth="1.5" />
          <path d="M40 104C86 92 108 70 168 42" fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 7" />
          <path d="M52 44C92 52 128 60 196 96" fill="none" stroke="#38bdf8" strokeWidth="2" strokeLinecap="round" strokeDasharray="1 7" />
          {[[168, 42], [196, 96], [120, 66]].map(([x, y]) => (
            <g key={`${x}-${y}`}>
              <circle cx={x} cy={y} r="5.5" fill="#fff" stroke="#0ea5e9" strokeWidth="2" />
              <circle cx={x} cy={y} r="2" fill="#0ea5e9" />
            </g>
          ))}
          <g transform="translate(30 96)">
            <rect x="0" y="2" width="16" height="11" rx="2" fill="#1e40af" />
            <path d="M16 6h5l3 3v4h-8Z" fill="#3b82f6" />
            <circle cx="6" cy="15" r="2.4" fill="#0f172a" />
            <circle cx="19" cy="15" r="2.4" fill="#0f172a" />
          </g>
        </svg>
        <span className="absolute bottom-2.5 left-2.5 inline-flex items-center gap-1.5 rounded-full bg-white/90 px-2.5 py-1 text-[10px] font-semibold text-belize-navy shadow-sm ring-1 ring-slate-200">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live tracking
        </span>
      </div>

      <Cta href="/register">Learn more</Cta>
    </article>
  );
}

/* ================================================================ Passenger */

function PassengerCard() {
  return (
    <article className={`${CARD} min-h-[210px]`}>
      <div className="flex items-start gap-3">
        <Badge tone="bg-emerald-500/10 text-emerald-600">{VanIcon}</Badge>
        <div>
          <h3 className="text-base font-bold text-belize-navy">Passenger Service</h3>
          <p className="mt-0.5 text-sm text-slate-500">Travel with confidence.</p>
        </div>
      </div>

      <div className="mt-4 flex-1 rounded-2xl bg-gradient-to-br from-emerald-50 to-white p-3.5" aria-hidden>
        <div className="flex flex-wrap gap-1.5">
          {['Shuttle', 'Water taxi', 'Airport'].map((m, i) => (
            <span key={m} className={`rounded-full px-2.5 py-1 text-[10px] font-semibold ${i === 0 ? 'bg-emerald-600 text-white' : 'bg-white text-slate-500 ring-1 ring-slate-200'}`}>{m}</span>
          ))}
        </div>
        <div className="mt-4 flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500 ring-4 ring-emerald-500/15" />
          <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,#10b981_0_5px,transparent_5px_10px)]" />
          <svg viewBox="0 0 24 24" fill="none" className="h-5 w-5 shrink-0 text-emerald-600"><path d="M3 8h9l4 3h4v5H3z" stroke="currentColor" strokeWidth="1.6" /><circle cx="7" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.6" /><circle cx="17" cy="17" r="1.6" stroke="currentColor" strokeWidth="1.6" /></svg>
          <span className="h-px flex-1 bg-[repeating-linear-gradient(90deg,#10b981_0_5px,transparent_5px_10px)]" />
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-white ring-2 ring-emerald-500" />
        </div>
        <div className="mt-1.5 flex items-center justify-between text-[10px] font-medium text-slate-500">
          <span>Belize City</span>
          <span>San Pedro</span>
        </div>
        <div className="mt-3 flex items-center justify-between rounded-xl bg-white px-3 py-2 ring-1 ring-slate-200">
          <span className="text-[11px] font-semibold text-belize-navy">Next departure</span>
          <span className="text-[11px] font-bold text-emerald-600">45 min · from BZ$30</span>
        </div>
      </div>

      <Cta href="/register">Learn more</Cta>
    </article>
  );
}

/* =========================================================== Belize Connect */

const JOBS = [
  { init: 'CS', tone: 'bg-blue-100 text-blue-700', title: 'Customer Service Rep', meta: 'Belize City · Full-time', tag: 'BZ$1,800' },
  { init: 'MS', tone: 'bg-violet-100 text-violet-700', title: 'Marketing Specialist', meta: 'Belmopan · Full-time', tag: 'New' },
  { init: 'DD', tone: 'bg-amber-100 text-amber-700', title: 'Delivery Driver', meta: 'Belize City · Full-time', tag: 'Apply' },
];

function BelizeConnectCard() {
  return (
    <article className={`${CARD} min-h-[240px]`}>
      <div className="flex items-start gap-3">
        <Badge tone="bg-amber-500/10 text-amber-600">{BriefcaseIcon}</Badge>
        <div>
          <h3 className="text-base font-bold text-belize-navy">Belize Connect</h3>
          <p className="mt-0.5 text-sm text-slate-500">Find jobs. Hire talent.</p>
        </div>
      </div>

      <div className="mt-4 flex-1" aria-hidden>
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-semibold text-belize-navy">Featured jobs</span>
          <span className="text-[11px] font-semibold text-belize-blue">View all</span>
        </div>
        <div className="space-y-2">
          {JOBS.map((j) => (
            <div key={j.title} className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white px-3 py-2 transition duration-300 group-hover:border-slate-200">
              <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[11px] font-bold ${j.tone}`}>{j.init}</span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[12px] font-semibold text-belize-navy">{j.title}</p>
                <p className="truncate text-[10px] text-slate-400">{j.meta}</p>
              </div>
              <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-600">{j.tag}</span>
            </div>
          ))}
        </div>
      </div>

      <Cta href="/register">Browse jobs</Cta>
    </article>
  );
}

/* =============================================================== Real Estate */

function RealEstateCard() {
  return (
    <article className={`${CARD} min-h-[240px]`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        {/* Listing visual */}
        <div className="relative aspect-[16/10] w-full shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-violet-500/20 via-sky-400/15 to-white sm:aspect-auto sm:w-44" aria-hidden>
          <svg viewBox="0 0 200 130" className="absolute inset-0 h-full w-full" preserveAspectRatio="xMidYMid slice">
            <circle cx="150" cy="30" r="60" fill="#a78bfa" opacity="0.18" />
            <circle cx="150" cy="30" r="40" fill="#818cf8" opacity="0.18" />
            <path d="M0 96h200v34H0z" fill="#c7d2fe" opacity="0.4" />
            <g transform="translate(38 44)" fill="none" stroke="#6d28d9" strokeOpacity="0.5" strokeWidth="2" strokeLinejoin="round">
              <path d="M0 46V20l24-16 24 16v26" fill="#ede9fe" fillOpacity="0.7" />
              <path d="M60 46V28l20-12 20 12v18" fill="#ddd6fe" fillOpacity="0.7" />
              <rect x="16" y="30" width="9" height="16" fill="#fff" fillOpacity="0.8" />
              <rect x="70" y="30" width="8" height="16" fill="#fff" fillOpacity="0.8" />
            </g>
          </svg>
          <span className="absolute left-2.5 top-2.5 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-bold text-violet-700 shadow-sm">For sale</span>
          <span className="absolute right-2.5 top-2.5 flex h-6 w-6 items-center justify-center rounded-full bg-white/90 text-slate-500 shadow-sm">
            <svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M12 20s-6.5-4.3-8.5-8A4 4 0 0 1 12 6.5 4 4 0 0 1 20.5 12c-2 3.7-8.5 8-8.5 8Z" stroke="currentColor" strokeWidth="1.8" /></svg>
          </span>
          <span className="absolute bottom-2.5 left-2.5 rounded-lg bg-white/95 px-2.5 py-1 text-xs font-bold text-belize-navy shadow-sm">BZ$450,000</span>
        </div>

        {/* Listing detail */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-3">
            <Badge tone="bg-violet-500/10 text-violet-600">{HomeIcon}</Badge>
            <div>
              <h3 className="text-base font-bold text-belize-navy">Real Estate</h3>
              <p className="mt-0.5 text-sm text-slate-500">Find your place.</p>
            </div>
          </div>
          <p className="mt-3 text-sm font-semibold text-belize-navy" aria-hidden>Modern Family Villa</p>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] font-medium text-slate-500" aria-hidden>
            <span className="inline-flex items-center gap-1"><svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M3 12V8a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v1h11v6" stroke="currentColor" strokeWidth="1.6" /><path d="M3 12h18v4M5 16v2M19 16v2" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>3 Bed</span>
            <span className="inline-flex items-center gap-1"><svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M5 4v8m0 0h14a1 1 0 0 1 1 1v2a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4v-2a1 1 0 0 1 1-1Z" stroke="currentColor" strokeWidth="1.6" /></svg>2 Bath</span>
            <span className="inline-flex items-center gap-1"><svg viewBox="0 0 24 24" fill="none" className="h-3.5 w-3.5"><path d="M12 21s-6-5.2-6-10a6 6 0 0 1 12 0c0 4.8-6 10-6 10Z" stroke="currentColor" strokeWidth="1.6" /><circle cx="12" cy="11" r="2" stroke="currentColor" strokeWidth="1.6" /></svg>Belize City</span>
          </div>
          <Cta href="/register" className="text-violet-700">View properties</Cta>
        </div>
      </div>
    </article>
  );
}

/* ================================================================= Marketing */

function MarketingCard() {
  return (
    <article className={`${CARD} min-h-[240px]`}>
      <div className="flex items-start gap-3">
        <Badge tone="bg-rose-500/10 text-rose-600">{ChartIcon}</Badge>
        <div>
          <h3 className="text-base font-bold text-belize-navy">Marketing</h3>
          <p className="mt-0.5 text-sm text-slate-500">Grow your business.</p>
        </div>
      </div>

      <div className="mt-4 flex-1 rounded-2xl border border-slate-100 bg-white p-3.5" aria-hidden>
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-semibold text-belize-navy">Campaign performance</span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[9px] font-semibold text-slate-500">This month</span>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-2">
          {[['Reach', '28.6K', '+9%'], ['Clicks', '3.2K', '+15%'], ['Leads', '620', '+6%']].map(([k, v, d]) => (
            <div key={k} className="rounded-lg bg-slate-50 px-2 py-1.5">
              <p className="text-[9px] font-medium uppercase tracking-wide text-slate-400">{k}</p>
              <p className="text-[13px] font-bold text-belize-navy">{v}</p>
              <p className="text-[9px] font-semibold text-emerald-600">{d}</p>
            </div>
          ))}
        </div>
        <svg viewBox="0 0 240 70" className="mt-3 h-16 w-full" preserveAspectRatio="none">
          <defs>
            <linearGradient id="mkt-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="#f43f5e" stopOpacity="0.22" />
              <stop offset="1" stopColor="#f43f5e" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d="M0 56C28 50 42 32 66 36c26 5 40-20 70-13 28 7 48-12 104-19V70H0Z" fill="url(#mkt-fill)" />
          <path d="M0 56C28 50 42 32 66 36c26 5 40-20 70-13 28 7 48-12 104-19" fill="none" stroke="#f43f5e" strokeWidth="2.2" strokeLinecap="round" />
          <circle cx="240" cy="4" r="3" fill="#f43f5e" />
        </svg>
      </div>

      <Cta href="/register" className="text-rose-600">Explore marketing</Cta>
    </article>
  );
}

/* ============================================================= Platform Wallet */

function WalletCard() {
  return (
    <article className={`${CARD} min-h-[240px]`}>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-stretch">
        {/* Balance card */}
        <div className="relative w-full shrink-0 overflow-hidden rounded-2xl bg-gradient-to-br from-teal-600 to-emerald-700 p-4 text-white sm:w-56" aria-hidden>
          <div className="pointer-events-none absolute -right-8 -top-10 h-28 w-28 rounded-full bg-white/15 blur-2xl" />
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-medium uppercase tracking-wide text-white/70">Wallet balance</span>
            <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4 text-white/80"><rect x="3" y="6" width="18" height="13" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="16.5" cy="12.5" r="1.2" fill="currentColor" /></svg>
          </div>
          <p className="mt-1 text-2xl font-bold tracking-tight">BZ$1,250.00</p>
          <div className="mt-4 grid grid-cols-4 gap-1.5">
            {[
              ['Top up', <path key="p" d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />],
              ['Send', <path key="s" d="M4 12 20 5l-6 15-3-6-7-2Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />],
              ['Request', <path key="r" d="M12 19V5m0 14-5-5m5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />],
              ['QR', <><rect key="q1" x="4" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect key="q2" x="14" y="4" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><rect key="q3" x="4" y="14" width="6" height="6" rx="1" stroke="currentColor" strokeWidth="1.6" /><path key="q4" d="M14 14h3v3m3 0v3h-6v-3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></>],
            ].map(([label, path]) => (
              <div key={label as string} className="flex flex-col items-center gap-1">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/15 text-white">
                  <svg viewBox="0 0 24 24" fill="none" className="h-4 w-4">{path as ReactNode}</svg>
                </span>
                <span className="text-[8.5px] font-medium text-white/80">{label as string}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Detail + transactions */}
        <div className="flex min-w-0 flex-1 flex-col">
          <div className="flex items-start gap-3">
            <Badge tone="bg-teal-500/10 text-teal-600">{WalletIcon}</Badge>
            <div>
              <h3 className="text-base font-bold text-belize-navy">Platform Wallet</h3>
              <p className="mt-0.5 text-sm text-slate-500">One wallet. Endless possibilities.</p>
            </div>
          </div>
          <div className="mt-3 space-y-1.5" aria-hidden>
            <p className="text-[11px] font-semibold text-belize-navy">Recent transactions</p>
            {[
              ['Payment to vendor', 'May 20', '-BZ$120.00', 'text-slate-700'],
              ['Wallet top-up', 'May 18', '+BZ$500.00', 'text-emerald-600'],
            ].map(([label, date, amt, tone]) => (
              <div key={label} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-1.5">
                <div className="min-w-0">
                  <p className="truncate text-[11px] font-medium text-belize-navy">{label}</p>
                  <p className="text-[9px] text-slate-400">{date}</p>
                </div>
                <span className={`shrink-0 text-[11px] font-bold ${tone}`}>{amt}</span>
              </div>
            ))}
          </div>
          <Cta href="/#wallet" className="text-teal-600">Explore wallet</Cta>
        </div>
      </div>
    </article>
  );
}
