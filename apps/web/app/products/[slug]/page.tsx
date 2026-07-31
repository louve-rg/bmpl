import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
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
          <Link href="/products" className="text-sm font-medium text-belize-blue hover:underline">← Shop</Link>
          <ProductView product={p} />
        </div>
      </main>
      <Footer />
    </>
  );
}
