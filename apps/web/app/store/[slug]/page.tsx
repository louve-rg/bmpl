import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { StorefrontView, type Storefront } from '../../../components/storefront/StorefrontView';
import { serverGet } from '../../../lib/server-api';

export const dynamic = 'force-dynamic';

async function fetchStore(slug: string): Promise<Storefront | null> {
  try {
    return await serverGet<Storefront>(`/marketplace/vendors/${encodeURIComponent(slug)}`);
  } catch {
    return null; // 404 / not approved
  }
}

export default async function StorefrontPage({ params }: { params: { slug: string } }) {
  const store = await fetchStore(params.slug);
  if (!store) notFound();

  return (
    <>
      <Header />
      <main>
        <StorefrontView store={store} />
        <div className="container-bmpl pb-12">
          <Link href="/vendors" className="text-sm text-belize-blue hover:underline">
            ← All vendors
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
