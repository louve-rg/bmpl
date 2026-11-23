import Link from 'next/link';
import { Logo } from '../Logo';
import { ButtonLink } from '../ui';
import { contactMailto } from '../../lib/contact';

/**
 * S2-ANNOUNCE homepage block. Deliberately NOT a "Coming Soon" template: no
 * countdown (the owner confirmed February 2027, not a day — a countdown
 * needs a day we don't have), no email-capture form (nothing exists to post
 * it to -- god's own ruling: this app has no Contact/About/FAQ page at all,
 * so the working CTA is `contactMailto()`, the one shared public-contact
 * constant (`lib/contact.ts`, S2-EMAIL) Footer.tsx/DeliveryTracker.tsx/
 * CollectionHoldMessage.tsx all use -- not a second hardcoded copy of the
 * address, and not a link to a page that doesn't exist), no overlay/popup.
 *
 * Concept: a shipping manifest, not a hype card. The left column is laid out
 * like a waybill — sender (the brand mark), the one fact that matters (the
 * month), a line of what it means, the shipment's contents (the supporting
 * paragraph). The right column's dotted route connecting the four real
 * service names IS the "one platform" claim, drawn as the thing it describes
 * — four separate services joining one line — not a decorative blob.
 * Labels are the exact headings Services.tsx already uses one section down
 * (Marketplace / Shipping & Delivery / Passenger Service / Platform Wallet),
 * so this isn't new vocabulary, it's the same four cards previewed early.
 *
 * Sits directly below Hero, in its own visually distinct navy band, so it
 * reads as the second, quieter beat after the photographic hero rather than
 * a second hero competing with the first — same palette (belize-navy, the
 * same blue/light accents Hero already uses), smaller type scale than
 * Hero's own h1, so the hierarchy stays Hero > this.
 *
 * Plain server component — the route-line "draw" is a single CSS animation
 * (.s2-route-draw / .s2-node, apps/web/app/globals.css) that plays once on
 * mount; no IntersectionObserver, no client JS. It sits high enough on the
 * page (right after Hero) that "on mount" and "on scroll into view" are the
 * same moment for almost every viewport. prefers-reduced-motion gets its own
 * scoped rule in globals.css (see that file's comment) rather than relying
 * on the shared global override, which only zeroes `animation-duration`, not
 * the per-node `animation-delay` set below — caught live via a screenshot
 * taken under emulated reduced motion, where two of the four nodes were
 * still invisible most of a second after load.
 */
export function LaunchAnnouncement() {
  return (
    <section id="launch" aria-labelledby="launch-heading" className="bg-belize-navy py-14 sm:py-16 lg:py-20">
      <div className="container-bmpl grid gap-10 lg:grid-cols-[1fr_auto] lg:items-center lg:gap-16">
        <div className="max-w-[580px]">
          <div className="flex items-center gap-2.5">
            <Logo size={28} />
            <span className="text-xs font-semibold uppercase tracking-[0.14em] text-belize-light">
              Belize Marketplace &amp; Logistics
            </span>
          </div>

          <h2 id="launch-heading" className="mt-4 text-3xl font-bold leading-[1.1] tracking-tight text-white sm:text-4xl">
            Coming February 2027
          </h2>
          <p className="mt-2 text-lg font-medium text-belize-light sm:text-xl">
            One platform. More possibilities for Belize.
          </p>

          <p className="mt-5 max-w-lg text-base leading-relaxed text-blue-100/80">
            We&rsquo;re building the one place to shop, ship, travel and earn across all six
            districts — one account, one wallet, one platform, built in Belize for Belize.
          </p>

          <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:gap-4">
            <ButtonLink href={contactMailto('Belize Marketplace & Logistics launch')} variant="accent" size="lg">
              Get in touch
            </ButtonLink>
            <Link
              href="#services"
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-white/25 px-7 py-3.5 text-base font-semibold text-white transition hover:bg-white/10 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
            >
              See what&rsquo;s launching
            </Link>
          </div>
        </div>

        {/* Decorative route graphic — the four real services, one line. Hidden
            below `lg`: it's an enhancement of the text above, not a second
            copy of the content, so a narrow viewport just keeps the words. */}
        <div className="hidden lg:block" aria-hidden>
          <svg viewBox="0 0 220 280" width="220" height="280" fill="none" className="s2-route-graphic overflow-visible">
            <path
              d="M30 24 L30 256"
              stroke="#60a5fa"
              strokeWidth="2"
              strokeDasharray="4 7"
              strokeLinecap="round"
              className="s2-route-draw"
              pathLength={100}
            />
            {[
              { y: 24, label: 'Marketplace' },
              { y: 101, label: 'Shipping & Delivery' },
              { y: 178, label: 'Passenger Service' },
              { y: 256, label: 'Platform Wallet' },
            ].map((n, i) => (
              <g key={n.label} className="s2-node" style={{ animationDelay: `${0.5 + i * 0.18}s` }}>
                <circle cx="30" cy={n.y} r="6" fill="#0ea5e9" />
                <circle cx="30" cy={n.y} r="6" stroke="#bfdbfe" strokeWidth="1.5" fill="none" />
                <text x="48" y={n.y + 4.5} fill="#e0f2fe" fontSize="13" fontWeight="600">
                  {n.label}
                </text>
              </g>
            ))}
          </svg>
        </div>
      </div>
    </section>
  );
}
