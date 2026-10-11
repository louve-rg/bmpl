import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { Alert, PlaceholderBadge } from '../../components/ui';

export const metadata = {
  title: 'Privacy Policy · Belize Marketplace & Logistics',
  description: 'How Belize Marketplace & Logistics handles personal data.',
};

/**
 * MDF-109: the sign-up flow's "Privacy Policy" consent link pointed at
 * nothing (`href="#"`, app/register/page.tsx). This route exists so that
 * link has a real destination. Content is the owner's and Angela's call,
 * not ours -- see the placeholder notice below. Do not add legal text here.
 */
export default function PrivacyPolicyPage() {
  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          <div className="max-w-3xl">
            <p className="bmpl-eyebrow">Legal</p>
            <h1 className="bmpl-page-title mt-1">Privacy Policy</h1>
            <div className="mt-3">
              <PlaceholderBadge>Content pending legal review</PlaceholderBadge>
            </div>
            <Alert tone="info" className="mt-6">
              The Privacy Policy is being drafted and reviewed before publication. This page is a
              placeholder so the sign-up page&apos;s consent link has somewhere real to go in the
              meantime -- the final text will appear here once it is approved.
            </Alert>
            <p className="mt-8 text-sm leading-relaxed text-slate-600">
              Questions in the meantime can go to{' '}
              <a href="mailto:support@bzemarketplace.com" className="text-belize-blue hover:underline">
                support@bzemarketplace.com
              </a>
              .
            </p>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
