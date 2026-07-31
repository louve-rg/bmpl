import Link from 'next/link';

/**
 * Closing statement — deliberately minimal: large centered typography, a soft
 * ambient glow, two clear actions, and a curved divider that hands off into the
 * navy footer. No dark container; the whitespace carries the weight.
 */
export function FinalCTA() {
  return (
    <section className="relative overflow-hidden bg-slate-50 pb-40 pt-24 sm:pb-48 sm:pt-32">
      <div className="pointer-events-none absolute left-1/2 top-8 h-[30rem] w-[44rem] max-w-[92vw] -translate-x-1/2 rounded-full bg-belize-accent/10 blur-[130px]" aria-hidden />

      <div className="relative mx-auto max-w-3xl px-6 text-center">
        <h2 className="text-4xl font-bold leading-[1.05] tracking-tight text-belize-navy sm:text-5xl lg:text-6xl">
          The Future of Commerce
          <br />
          <span className="text-belize-blue">Starts Here.</span>
        </h2>
        <p className="mx-auto mt-6 max-w-2xl text-lg leading-relaxed text-slate-600">
          Everything Belize needs to buy, sell, ship, travel, hire, invest, and grow — all from one
          secure platform.
        </p>
        <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row sm:gap-4">
          <Link
            href="/register"
            className="inline-flex w-full items-center justify-center rounded-xl bg-gradient-to-r from-belize-accent to-belize-blue px-8 py-4 text-base font-semibold text-white shadow-lg shadow-belize-accent/25 transition duration-300 hover:shadow-xl hover:shadow-belize-accent/40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent sm:w-auto"
          >
            Create Free Account
          </Link>
          <Link
            href="/login"
            className="inline-flex w-full items-center justify-center rounded-xl border border-slate-300 px-8 py-4 text-base font-semibold text-belize-navy transition duration-300 hover:border-belize-blue hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent sm:w-auto"
          >
            Sign In
          </Link>
        </div>
      </div>

      {/* Curved hand-off into the navy footer. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 leading-[0]" aria-hidden>
        <svg viewBox="0 0 1440 90" preserveAspectRatio="none" className="block h-[56px] w-full sm:h-[80px]">
          <path d="M0 34 C420 -6 1020 -6 1440 34 L1440 90 L0 90 Z" fill="#0f172a" />
        </svg>
      </div>
    </section>
  );
}
