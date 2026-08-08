import type { Metadata } from 'next';
import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { ButtonLink, Card } from '../../components/ui';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';

export const metadata: Metadata = {
  title: 'Shipping & Delivery · Belize Marketplace & Logistics',
  description:
    'How delivery works across Belize — nationwide coverage, vetted drivers, PIN-verified handover and live order tracking.',
};

/**
 * PUBLIC Shipping & Delivery page.
 *
 * The landing page's "Learn more" pointed at /register, so a visitor trying to
 * understand the service was asked to create an account first. Someone deciding
 * whether to use a courier has no reason to sign up before they know what it is,
 * and being bounced to a form reads as a broken link rather than a gate.
 *
 * Everything here is informational and requires no session. Only the actions
 * that genuinely need an account link onward to auth, and those carry `?next=`
 * so signing in returns you to what you were doing instead of the dashboard.
 */
const STEPS = [
  {
    title: 'Order from any store',
    body: 'Shop the marketplace and pick delivery at checkout. The fee is shown before you pay — no surprises at the door.',
  },
  {
    title: 'The store packs it',
    body: 'You will see the order move to preparing, then ready, so you know where it is before a driver is involved.',
  },
  {
    title: 'A vetted driver collects it',
    body: 'Drivers are matched automatically by district and availability. Every driver is identity-checked with an approved photo and an inspected, insured vehicle.',
  },
  {
    title: 'PIN-verified handover',
    body: 'Collection and delivery are each confirmed with a short code, so a parcel cannot be collected or handed over to the wrong person.',
  },
  {
    title: 'Track it to your door',
    body: 'Watch the driver move through picked up, on the way, and arriving — with proof of delivery when it lands.',
  },
];

export default function ShippingAndDeliveryPage() {
  return (
    <>
      <Header />
      <main>
        <section className="bg-gradient-to-b from-sky-50 to-white py-14 sm:py-20">
          <div className="container-bmpl">
            <p className="bmpl-eyebrow">Shipping &amp; Delivery</p>
            <h1 className="bmpl-page-title mt-2 max-w-3xl">
              Land, air &amp; sea — to every district in Belize.
            </h1>
            <p className="mt-4 max-w-2xl text-lg text-slate-600">
              Order from any store on the marketplace and have it delivered by a vetted local
              driver, with verified handover and tracking from the shop counter to your door.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              {/* Public browsing needs no account. */}
              <ButtonLink href="/products">Browse the marketplace</ButtonLink>
              {/* This one genuinely needs a session, so it returns you here after. */}
              <ButtonLink href="/register?next=/dashboard/roles" variant="outline">
                Drive with us
              </ButtonLink>
            </div>
          </div>
        </section>

        <section className="py-14">
          <div className="container-bmpl">
            <h2 className="text-2xl font-bold text-belize-navy">How it works</h2>
            <ol className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
              {STEPS.map((s, i) => (
                <li key={s.title}>
                  <Card className="h-full p-5">
                    <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-belize-blue/10 text-sm font-bold text-belize-blue">
                      {i + 1}
                    </span>
                    <h3 className="mt-3 font-semibold text-belize-navy">{s.title}</h3>
                    <p className="mt-1.5 text-sm text-slate-600">{s.body}</p>
                  </Card>
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section className="bg-slate-50 py-14">
          <div className="container-bmpl">
            <h2 className="text-2xl font-bold text-belize-navy">Where we deliver</h2>
            <p className="mt-2 max-w-2xl text-slate-600">
              All six districts. Coverage and timing depend on the store you order from and the
              drivers available in your area.
            </p>
            <ul className="mt-6 flex flex-wrap gap-2">
              {DISTRICTS.map((d) => (
                <li
                  key={d}
                  className="rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-belize-navy"
                >
                  {DISTRICT_LABELS[d]}
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="py-14">
          <div className="container-bmpl grid gap-4 md:grid-cols-2">
            <Card className="p-6">
              <h3 className="font-semibold text-belize-navy">Pickup instead</h3>
              <p className="mt-1.5 text-sm text-slate-600">
                Prefer to collect it yourself? Choose pickup at checkout and show the store your
                collection code. No delivery fee.
              </p>
            </Card>
            <Card className="p-6">
              <h3 className="font-semibold text-belize-navy">Selling on BMPL?</h3>
              <p className="mt-1.5 text-sm text-slate-600">
                Stores set their own delivery area and fee, mark orders ready when packed, and a
                driver is found automatically.
              </p>
              <Link
                href="/register?next=/dashboard/roles"
                className="mt-3 inline-block text-sm font-semibold text-belize-blue hover:underline"
              >
                Become a seller →
              </Link>
            </Card>
          </div>
        </section>
      </main>
      <Footer />
    </>
  );
}
