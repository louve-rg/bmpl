import { ButtonLink } from '../ui';

export function FinalCTA() {
  return (
    <section className="bg-belize-navy py-20">
      <div className="container-bmpl text-center">
        <h2 className="text-3xl font-bold text-white sm:text-4xl">Ready to Get Started?</h2>
        <p className="mx-auto mt-3 max-w-xl text-lg text-blue-100">
          Join Belizeans choosing a smarter way to shop, ship, and connect.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-4">
          <ButtonLink href="/register" variant="accent" size="lg">
            Create your free account
          </ButtonLink>
          <ButtonLink
            href="/login"
            variant="outline"
            size="lg"
            className="!border-white !text-white hover:!bg-white/10"
          >
            Sign in
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
