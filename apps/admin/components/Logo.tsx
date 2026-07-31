import Image from 'next/image';

/**
 * Brand logo — the official circular badge, clipped to a circle so the square
 * canvas never shows. Mirrors apps/web/components/Logo.tsx.
 */
export function Logo({ size = 40 }: { size?: number }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-belize-hero"
      style={{ width: size, height: size }}
      aria-hidden
    >
      <Image src="/images/logo.png" alt="" width={size} height={size} priority className="h-full w-full scale-[1.12] rounded-full object-cover" />
    </span>
  );
}

export function BrandLockup({ subtitle = 'Admin Console' }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Logo size={40} />
      <span className="flex flex-col leading-tight">
        <span className="text-sm font-bold uppercase tracking-wide text-white">Belize Marketplace</span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.18em] text-belize-light">{subtitle}</span>
      </span>
    </span>
  );
}
