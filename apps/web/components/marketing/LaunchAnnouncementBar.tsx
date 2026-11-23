import Link from 'next/link';

/**
 * S2-ANNOUNCE: the site-wide "Coming February 2027" strip. Static marketing
 * copy with a fixed month, not operational state — unlike AnnouncementBanner
 * (components/AnnouncementBanner.tsx), which polls `/marketplace/announcement`
 * for admin-authored INFO/WARNING/CRITICAL messages. Deliberately a plain
 * server component: nothing here is dynamic, so there is nothing to fetch,
 * nothing to flash-in after hydration, and no client JS to ship for it.
 *
 * Rendered as the FIRST element in <body> (apps/web/app/layout.tsx), in normal
 * document flow, not `sticky`/`fixed`. Two existing headers are already
 * `sticky top-0` (the public Header, and the authenticated dashboard shell's
 * header) — putting this bar in-flow above them changes where they START on
 * the page, not how they behave once stuck, so neither one needs touching.
 * Being the literal first thing in the body (this layout sets
 * `viewport-fit=cover`) means THIS element owns the top safe-area inset, not
 * either header below it — see the inline style.
 */
export function LaunchAnnouncementBar() {
  return (
    <div
      className="w-full bg-belize-navy text-white"
      style={{ paddingTop: 'max(0.4rem, env(safe-area-inset-top))' }}
    >
      <div className="container-bmpl flex items-center justify-center gap-2 py-1.5 text-center text-xs font-medium sm:text-sm">
        <svg aria-hidden viewBox="0 0 20 20" fill="none" className="h-3.5 w-3.5 shrink-0 text-belize-light">
          <rect x="3" y="4.5" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.6" />
          <path d="M3 8h14M7 2.5v3M13 2.5v3" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
        </svg>
        <span>
          Coming February 2027 —
          <Link href="/#launch" className="ml-1 underline decoration-belize-light/50 underline-offset-2 hover:text-belize-light">
            learn more
          </Link>
        </span>
      </div>
    </div>
  );
}
