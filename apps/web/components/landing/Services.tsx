import { SectionHeading } from '../ui';
import { SERVICES } from './data';

export function Services() {
  return (
    <section id="services" className="bg-slate-50 py-20">
      <div className="container-bmpl">
        <SectionHeading
          eyebrow="Our Services"
          title="Everything Belize needs, in one platform"
          subtitle="Comprehensive solutions for all your business and personal needs."
        />
        <div className="mt-12 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SERVICES.map((service) => (
            <article
              key={service.id}
              className="group relative flex flex-col rounded-2xl border border-slate-200 bg-white p-6 shadow-sm transition hover:-translate-y-1 hover:border-belize-light hover:shadow-glow"
            >
              <div className="flex items-center justify-between">
                <span
                  className="flex h-12 w-12 items-center justify-center rounded-xl bg-belize-hero text-2xl"
                  aria-hidden
                >
                  {service.icon}
                </span>
                {service.status === 'coming-soon' && (
                  <span className="rounded-full bg-belize-accent/10 px-2.5 py-0.5 text-xs font-semibold text-belize-accent">
                    Coming soon
                  </span>
                )}
              </div>
              <h3 className="mt-4 text-lg font-bold text-belize-navy">{service.name}</h3>
              <p className="text-sm font-medium text-belize-accent">{service.tagline}</p>
              <p className="mt-2 flex-1 text-sm leading-relaxed text-slate-600">
                {service.description}
              </p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
