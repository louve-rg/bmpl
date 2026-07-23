import { SectionHeading } from '../ui';
import { TRUST_POINTS } from './data';

export function WhyChooseUs() {
  return (
    <section className="bg-belize-navy py-20">
      <div className="container-bmpl">
        <SectionHeading eyebrow="Why Choose Us" title="Built on trust, made for Belize" dark />
        <div className="mt-12 grid gap-6 md:grid-cols-3">
          {TRUST_POINTS.map((point) => (
            <div
              key={point.title}
              className="rounded-2xl border border-white/10 bg-white/5 p-7 text-center"
            >
              <span className="text-4xl" aria-hidden>
                {point.icon}
              </span>
              <h3 className="mt-4 text-xl font-bold text-white">{point.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-blue-100">{point.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
