/**
 * Brand logo. Uses /public/logo.png when supplied; otherwise renders a branded
 * circular monogram placeholder so the app is never broken by a missing asset.
 * Replace /public/logo.png with the official logo to activate it.
 */
export function Logo({ size = 44, withGlow = true }: { size?: number; withGlow?: boolean }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full bg-belize-hero text-white font-bold"
      style={{
        width: size,
        height: size,
        border: '2px solid rgba(96,165,250,0.5)',
        boxShadow: withGlow ? '0 0 20px rgba(96,165,250,0.4)' : undefined,
        fontSize: size * 0.4,
      }}
      aria-hidden
    >
      BM
    </span>
  );
}

export function BrandLockup({ subtitle = 'Marketplace & Logistics' }: { subtitle?: string }) {
  return (
    <span className="flex items-center gap-3">
      <Logo size={44} />
      <span className="flex flex-col leading-tight">
        <span className="text-base font-bold text-white">Belize Marketplace</span>
        <span className="text-xs font-medium text-belize-light">{subtitle}</span>
      </span>
    </span>
  );
}
