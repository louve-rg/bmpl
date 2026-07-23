import { ButtonLink, SectionHeading } from '../ui';

const PROVIDER_ROLES = [
  'Vendor',
  'Delivery Driver',
  'Shipping Provider',
  'Passenger Driver',
  'Employer',
  'Real-Estate Agent',
  'Property Owner',
  'Marketing Client',
];

export function Providers() {
  return (
    <section id="providers" className="bg-belize-accent/5 py-20">
      <div className="container-bmpl">
        <SectionHeading
          eyebrow="For Businesses & Providers"
          title="Sell, ship, drive, hire — from one account"
          subtitle="Register once, then request the provider roles you need. Each is reviewed and approved by our team."
        />
        <div className="mx-auto mt-10 flex max-w-3xl flex-wrap justify-center gap-3">
          {PROVIDER_ROLES.map((role) => (
            <span
              key={role}
              className="rounded-full border border-belize-light bg-white px-4 py-2 text-sm font-medium text-belize-blue"
            >
              {role}
            </span>
          ))}
        </div>
        <div className="mt-10 flex justify-center">
          <ButtonLink href="/register" variant="primary" size="lg">
            Become a provider
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
