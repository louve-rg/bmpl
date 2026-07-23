import { PlaceholderBadge, SectionHeading } from '../ui';

const CAPABILITIES = [
  'Customer payments',
  'Vendor & driver earnings',
  'Refunds & escrow',
  'Platform fees',
  'Top-ups & transfers',
  'Withdrawals',
];

export function WalletSection() {
  return (
    <section id="wallet" className="bg-white py-20">
      <div className="container-bmpl grid gap-10 md:grid-cols-2 md:items-center">
        <div>
          <SectionHeading
            eyebrow="Platform Wallet"
            title="One secure wallet for the whole platform"
          />
          <p className="mt-4 text-slate-600">
            A single balance to pay vendors, receive earnings, and settle deliveries — built on a
            double-entry ledger for accuracy and auditability. Money movement activates once payment
            and regulatory integration is complete.
          </p>
          <div className="mt-6">
            <PlaceholderBadge>Wallet transactions launch in a later phase</PlaceholderBadge>
          </div>
        </div>
        <ul className="grid grid-cols-2 gap-3">
          {CAPABILITIES.map((cap) => (
            <li
              key={cap}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-belize-navy"
            >
              <span className="text-belize-accent" aria-hidden>
                ✓
              </span>
              {cap}
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
