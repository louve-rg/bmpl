import { Logo } from '../Logo';
import { ButtonLink } from '../ui';

export function Hero() {
  return (
    <section className="relative overflow-hidden bg-belize-hero">
      <div
        className="pointer-events-none absolute inset-0 opacity-20"
        style={{
          backgroundImage:
            'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.25), transparent 40%), radial-gradient(circle at 80% 0%, rgba(14,165,233,0.4), transparent 45%)',
        }}
        aria-hidden
      />
      <div className="container-bmpl relative grid gap-10 py-20 md:grid-cols-2 md:items-center md:py-28">
        <div>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-sm font-medium text-blue-100 ring-1 ring-white/20">
            🇧🇿 Proudly built for Belize
          </span>
          <h1 className="mt-5 text-4xl font-bold leading-tight text-white sm:text-5xl lg:text-6xl">
            Your Complete
            <br />
            Commerce Solution
          </h1>
          <p className="mt-5 max-w-xl text-lg text-blue-100">
            Comprehensive solutions for all your business and personal needs — marketplace,
            shipping &amp; delivery, passenger service, employment, real estate, marketing, and a
            secure platform wallet. One account, every service.
          </p>
          <div className="mt-8 flex flex-wrap gap-4">
            <ButtonLink href="/register" variant="accent" size="lg">
              Get started free
            </ButtonLink>
            <ButtonLink href="#services" variant="outline" size="lg" className="!border-white !text-white hover:!bg-white/10">
              Explore services
            </ButtonLink>
          </div>
          <p className="mt-6 text-sm text-blue-200">
            Join Belizeans choosing a smarter way to shop, ship, and connect.
          </p>
        </div>

        <div className="flex justify-center">
          <div className="relative flex h-56 w-56 items-center justify-center rounded-full bg-white/5 ring-8 ring-white/10 sm:h-72 sm:w-72">
            <div className="scale-[3.2] sm:scale-[4]">
              <Logo size={44} />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
