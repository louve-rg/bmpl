import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { StorefrontView, type Storefront } from '../../../components/storefront/StorefrontView';
import { Breadcrumbs } from '../../../components/ui';
import { storefrontBreadcrumbs, STORES_HREF } from '../../../lib/marketplace-nav';
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
      <main className="bg-slate-50">
        <div className="container-bmpl pt-6">
          <Breadcrumbs items={storefrontBreadcrumbs(store.businessName)} />
        </div>
        <StorefrontView store={store} />
        <div className="container-bmpl pb-12">
          <Link href={STORES_HREF} className="text-sm font-medium text-belize-blue hover:underline">
            ← All stores
          </Link>
        </div>
      </main>
      <Footer />
    </>
  );
}
