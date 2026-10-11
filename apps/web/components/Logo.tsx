import Image from 'next/image';

/**
 * Brand logo — the official circular "Belize Marketplace and Logistics" badge.
 * The source image (public/images/logo.png) sits on a square canvas; we clip it
 * to a circle (rounded-full + overflow-hidden) so only the round badge shows,
 * never the square corners. A navy fill sits behind it so the layout stays clean
 * if the asset is not yet present.
 */
export function Logo({ size = 44 }: { size?: number; withGlow?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-belize-hero"
      style={{ width: size, height: size }}
      aria-hidden
    >
      {/* The badge fills ~90% of its square canvas (10% white margin). Zoom
          ~1.12x inside the circular mask so the white ring is clipped away and
          only the round badge shows — the ring text (~80-85%) stays intact. */}
      <Image
        src="/images/logo.png"
        alt=""
        width={size}
        height={size}
        priority
        className="h-full w-full scale-[1.12] rounded-full object-cover"
      />
    </span>
  );
}

export function BrandLockup({
  subtitle = 'And Logistics',
  allowTruncate = false,
}: {
  subtitle?: string;
  /**
   * Opt-in only (MDF-179): `truncate` forces `white-space: nowrap`, which
   * changes the text's own intrinsic/min-content width calculation --
   * wrappable text's min-content is just its longest unbreakable word,
   * nowrap text's min-content is the whole line. Turning that on
   * unconditionally widened this component's OTHER usage in the public
   * landing header (components/landing/Header.tsx), which relies on the
   * wordmark being able to wrap to stay inside its own `justify-between`
   * row at exactly `lg` (1024px) -- confirmed by measurement: that header's
   * brand block grew from 174px to 231px and pushed the row 16px past the
   * viewport. Defaults to false so every other call site renders bit-for-
   * bit the same DOM/classes as before this card; only the one call site
   * that actually needs to shrink (the authenticated dashboard header,
   * apps/web/app/dashboard/layout.tsx) passes it.
   */
  allowTruncate?: boolean;
}) {
  return (
    <span className={`flex items-center gap-3 ${allowTruncate ? 'min-w-0' : ''}`}>
      <Logo size={44} />
      <span className={`flex flex-col leading-tight ${allowTruncate ? 'min-w-0' : ''}`}>
        <span
          className={`text-sm font-bold uppercase tracking-wide text-white sm:text-base ${allowTruncate ? 'truncate' : ''}`}
        >
          Belize Marketplace
        </span>
        <span
          className={`text-[10px] font-semibold uppercase tracking-[0.18em] text-belize-light sm:text-xs ${allowTruncate ? 'truncate' : ''}`}
        >
          {subtitle}
        </span>
      </span>
    </span>
  );
}
