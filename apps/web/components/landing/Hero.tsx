import Image from 'next/image';
import { ButtonLink } from '../ui';

/**
 * Landing hero. The background is the supplied port/ship photo which ALREADY
 * contains the large circular brand logo — so we deliberately do NOT overlay a
 * second logo. A left-to-right navy gradient keeps the headline legible while
 * leaving the ship, water, port, and logo visible on the right.
 *
 * The image lives at /images/hero-port.jpg (see public/images/README.md). A
 * solid navy fallback keeps the layout intact if the asset is not yet present.
 */
const HERO_OVERLAY =
  'linear-gradient(90deg, rgba(4,18,43,0.96) 0%, rgba(4,18,43,0.82) 35%, rgba(4,18,43,0.35) 62%, rgba(4,18,43,0.08) 100%)';

function ArrowRight() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ShieldIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M10 2.5l5.5 2v4.2c0 3.4-2.3 6-5.5 7-3.2-1-5.5-3.6-5.5-7V4.5L10 2.5z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      <path d="M7.5 10l1.8 1.8L13 8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function UsersIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <circle cx="8" cy="7" r="2.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M3.5 15.5a4.5 4.5 0 0 1 9 0" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M14 5.2a2.5 2.5 0 0 1 0 4.6M15.2 15.5a4.5 4.5 0 0 0-2.2-3.9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function HeadsetIcon() {
  return (
    <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-4 w-4">
      <path d="M4 11v-1a6 6 0 0 1 12 0v1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      <rect x="3" y="11" width="3" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <rect x="14" y="11" width="3" height="4.5" rx="1" stroke="currentColor" strokeWidth="1.5" />
      <path d="M16 15.5a3 3 0 0 1-3 2.5h-1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

export function Hero() {
  return (
    <section
      aria-labelledby="hero-heading"
      className="relative isolate flex min-h-[620px] items-center overflow-hidden bg-[#04122b] sm:min-h-[700px] lg:min-h-[760px]"
    >
      {/* Supplied background — the large logo is already part of this image. */}
      <Image
        src="/images/hero-port.jpg"
        alt=""
        fill
        priority
        sizes="100vw"
        className="object-cover object-center"
      />
      {/* Navy gradient (left → right) for headline legibility on desktop. */}
      <div className="absolute inset-0" style={{ backgroundImage: HERO_OVERLAY }} aria-hidden />
      {/* Extra scrim on small screens where the text sits directly over the image. */}
      <div className="absolute inset-0 bg-[#04122b]/55 md:hidden" aria-hidden />

      <div className="relative z-10 mx-auto w-full max-w-[1440px] px-4 pb-24 pt-16 sm:px-6 sm:pb-28 sm:pt-20 lg:px-12">
        <div className="max-w-[620px] lg:w-[46%]">
          {/* Eyebrow */}
          <div className="flex items-center gap-3">
            <span className="text-xs font-semibold uppercase tracking-[0.22em] text-belize-light sm:text-sm">
              Proudly built for Belize
            </span>
            <span className="h-px w-10 bg-belize-light/50" aria-hidden />
          </div>

          {/* Headline */}
          <h1
            id="hero-heading"
            className="mt-5 text-4xl font-bold leading-[1.05] tracking-tight text-white sm:text-5xl lg:text-6xl"
          >
            Your Complete
            <br />
            Commerce Solution
          </h1>

          {/* Description */}
          <p className="mt-6 max-w-lg text-base leading-relaxed text-blue-100/90 sm:text-lg">
            Marketplace, shipping &amp; delivery, passenger service, employment, real estate,
            marketing, and a secure platform wallet. One account, every service.
          </p>

          {/* Actions */}
          <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <ButtonLink
              href="/register"
              variant="primary"
              size="lg"
              className="!bg-[#1e5bd6] shadow-lg shadow-blue-950/30 hover:!bg-[#1a51be]"
            >
              Get started free
              <ArrowRight />
            </ButtonLink>
            <ButtonLink
              href="#services"
              variant="outline"
              size="lg"
              className="!border-white/60 !text-white hover:!bg-white/10"
            >
              Explore services
              <ArrowRight />
            </ButtonLink>
          </div>

          {/* Trust indicators */}
          <div className="mt-8 flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-blue-100">
            <span className="inline-flex items-center gap-2">
              <ShieldIcon /> Secure &amp; Reliable
            </span>
            <span className="hidden h-4 w-px bg-white/25 sm:inline-block" aria-hidden />
            <span className="inline-flex items-center gap-2">
              <UsersIcon /> Built for Belizeans
            </span>
            <span className="hidden h-4 w-px bg-white/25 sm:inline-block" aria-hidden />
            <span className="inline-flex items-center gap-2">
              <HeadsetIcon /> Local Support
            </span>
          </div>
        </div>
      </div>

      {/* Curved transition into the (slate-50) content below. */}
      <div className="absolute inset-x-0 bottom-0 z-10 leading-[0]" aria-hidden>
        <svg viewBox="0 0 1440 80" preserveAspectRatio="none" className="block h-[36px] w-full sm:h-[56px]">
          <path d="M0 0 C 360 72 1080 72 1440 0 L1440 80 L0 80 Z" fill="#f8fafc" />
        </svg>
      </div>
    </section>
  );
}
