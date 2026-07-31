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

export function BrandLockup({ subtitle = 'And Logistics' }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Logo size={44} />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-bold uppercase tracking-wide text-white sm:text-base">
          Belize Marketplace
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-belize-light sm:text-xs">
          {subtitle}
        </span>
      </span>
    </span>
  );
}
