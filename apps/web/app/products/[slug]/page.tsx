import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { Breadcrumbs } from '../../../components/ui';
import { productBreadcrumbs, productBackHref } from '../../../lib/marketplace-nav';
import { serverGet } from '../../../lib/server-api';
import { ProductView, type ProductDetail } from './ProductView';

export const dynamic = 'force-dynamic';

async function fetchProduct(slug: string): Promise<ProductDetail | null> {
  try {
    return await serverGet<ProductDetail>(`/marketplace/products/${encodeURIComponent(slug)}`);
  } catch {
    return null;
  }
}

export default async function ProductDetailPage({ params }: { params: { slug: string } }) {
  const p = await fetchProduct(params.slug);
  if (!p) notFound();

  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          {/* Breadcrumbs follow the true hierarchy: Stores → this storefront → product.
              Derived from product data, so shared/direct links get a correct trail too. */}
          <Breadcrumbs items={productBreadcrumbs(p.vendor, p.title)} />
          {/* Convenience link to the vendor storefront. This is NOT a browser-Back
              control (kept alongside the "Sold by" link lower on the page); worded
              "Visit {vendor}" so it never implies going back in history. */}
          <Link
            href={productBackHref(p.vendor.slug)}
            className="mt-2 inline-flex text-sm font-medium text-belize-blue hover:underline"
          >
            Visit {p.vendor.businessName}
          </Link>
          <ProductView product={p} />
        </div>
      </main>
      <Footer />
    </>
  );
}
