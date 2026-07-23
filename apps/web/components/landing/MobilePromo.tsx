import { PlaceholderBadge } from '../ui';

export function MobilePromo() {
  return (
    <section id="mobile" className="bg-white py-20">
      <div className="container-bmpl grid items-center gap-10 rounded-3xl bg-belize-hero px-8 py-12 md:grid-cols-2">
        <div>
          <h2 className="text-3xl font-bold text-white sm:text-4xl">
            Belize Marketplace, in your pocket
          </h2>
          <p className="mt-4 max-w-lg text-blue-100">
            Shop, track deliveries, manage your services, and switch roles on the go. The mobile app
            is in active development.
          </p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <span className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/20">
               App Store
            </span>
            <span className="inline-flex items-center gap-2 rounded-lg bg-black/40 px-4 py-2.5 text-sm font-medium text-white ring-1 ring-white/20">
              ▶ Google Play
            </span>
            <PlaceholderBadge>Store links coming at launch</PlaceholderBadge>
          </div>
        </div>
        <div className="flex justify-center">
          <div className="flex h-64 w-40 items-center justify-center rounded-[2rem] border-4 border-white/30 bg-white/10 text-center text-sm text-blue-100">
            Mobile app
            <br />
            preview
          </div>
        </div>
      </div>
    </section>
  );
}
