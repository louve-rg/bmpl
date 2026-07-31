import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGet } from '../../../lib/server-api';
import { Badge } from '../../../components/ui';
import { Gallery, type GalleryImage } from './Gallery';
import { AddToCart } from './AddToCart';

export const dynamic = 'force-dynamic';

interface ProductDetail {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  description: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  category: { name: string; slug: string };
  vendor: { businessName: string; slug: string };
  weightGrams: number | null;
  dimensionsMm: { length: number | null; width: number | null; height: number | null };
  tags: string[];
  images: GalleryImage[];
  availability: { inStock: boolean; lowStock: boolean };
  options: Array<{ id: string; name: string; values: Array<{ id: string; value: string }> }>;
  variants: Array<{ id: string; sku: string | null; priceMinor: number | null; salePriceMinor: number | null; optionValueIds: string[]; availability: { inStock: boolean; outOfStock: boolean } }>;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

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
  const dims = p.dimensionsMm;

  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          <Link href="/products" className="text-sm font-medium text-belize-blue hover:underline">← Shop</Link>
          <div className="mt-4 grid gap-8 md:grid-cols-2">
            <Gallery images={p.images} />

            <div>
              <p className="bmpl-eyebrow">{p.category.name}</p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-belize-navy">{p.title}</h1>
              {p.brand && <p className="text-sm text-slate-500">by {p.brand}</p>}

              <p className="mt-4 text-2xl">
                {p.salePriceMinor != null ? (
                  <>
                    <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
                    <span className="text-lg text-slate-400 line-through">{money(p.priceMinor)}</span>
                  </>
                ) : (
                  <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
                )}
                <span className="ml-2 text-sm text-slate-400">{p.currency}</span>
              </p>

              <p className="mt-2">
                <Badge tone={p.availability.inStock ? (p.availability.lowStock ? 'warning' : 'success') : 'error'}>
                  {p.availability.inStock ? (p.availability.lowStock ? 'Low stock' : 'In stock') : 'Out of stock'}
                </Badge>
              </p>

              <AddToCart
                productId={p.id}
                slug={p.slug}
                options={p.options}
                variants={p.variants}
                productInStock={p.availability.inStock}
                basePriceMinor={p.priceMinor}
                baseSalePriceMinor={p.salePriceMinor}
              />

              <p className="mt-3 text-sm text-slate-500">
                Sold by{' '}
                <Link href={`/store/${p.vendor.slug}`} className="font-medium text-belize-blue hover:underline">
                  {p.vendor.businessName}
                </Link>
              </p>

              {p.description && <p className="mt-5 whitespace-pre-wrap text-slate-600">{p.description}</p>}

              {(p.weightGrams || dims.length || dims.width || dims.height) && (
                <dl className="mt-6 grid grid-cols-2 gap-2 text-sm text-slate-600">
                  {p.weightGrams && <div><dt className="text-slate-400">Weight</dt><dd>{p.weightGrams} g</dd></div>}
                  {(dims.length || dims.width || dims.height) && (
                    <div><dt className="text-slate-400">Dimensions</dt><dd>{dims.length ?? '—'}×{dims.width ?? '—'}×{dims.height ?? '—'} mm</dd></div>
                  )}
                </dl>
              )}

              {p.tags.length > 0 && (
                <div className="mt-5 flex flex-wrap gap-1.5">
                  {p.tags.map((t) => (
                    <Badge key={t} tone="neutral">{t}</Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
