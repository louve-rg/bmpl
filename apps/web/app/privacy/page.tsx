import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { PlaceholderBadge } from '../../components/ui';
import { LegalDocument } from '../../components/legal/LegalDocument';
import { PRIVACY_POLICY_CONTENT } from '../../content/legal/privacy-policy';

export const metadata = {
  title: 'Privacy Policy · Belize Marketplace & Logistics',
  description: 'How Belize Marketplace & Logistics handles personal data.',
};

/**
 * MDF-109: the sign-up flow's "Privacy Policy" consent link pointed at
 * nothing (`href="#"`, app/register/page.tsx). This route exists so that
 * link has a real destination. Content below is Angela's draft, cleared by
 * the owner to publish here WITH its [OWNER DECISION: ...] placeholders
 * still visible -- see content/legal/privacy-policy.ts. Do not edit the
 * legal text in this file; a content change goes back through Angela/the
 * owner.
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          <div className="max-w-3xl">
            <p className="bmpl-eyebrow">Legal</p>
            <div className="mt-3">
              <PlaceholderBadge>Draft -- awaiting owner review</PlaceholderBadge>
            </div>
            <LegalDocument content={PRIVACY_POLICY_CONTENT} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
