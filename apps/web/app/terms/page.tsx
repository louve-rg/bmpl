import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { PlaceholderBadge } from '../../components/ui';
import { LegalDocument } from '../../components/legal/LegalDocument';
import { TERMS_OF_SERVICE_CONTENT } from '../../content/legal/terms-of-service';

export const metadata = {
  title: 'Terms of Service · Belize Marketplace & Logistics',
  description: 'The terms that govern use of the Belize Marketplace & Logistics platform.',
};

/**
 * MDF-109: the sign-up flow's "Terms" consent link pointed at nothing
 * (`href="#"`, app/register/page.tsx). This route exists so that link has a
 * real destination. Content below is Angela's draft, cleared by the owner
 * to publish here WITH its [OWNER DECISION: ...] placeholders still visible
 * -- see content/legal/terms-of-service.ts. Do not edit the legal text in
 * this file; a content change goes back through Angela/the owner.
 */
export default function TermsOfServicePage() {
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
            <LegalDocument content={TERMS_OF_SERVICE_CONTENT} />
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
