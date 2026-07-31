'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api, type ApiError } from '../../../../lib/api';
import { ProductForm, type ProductValues } from '../ProductForm';
import { ImageManager } from '../ImageManager';
import { VariantsInventory } from '../VariantsInventory';
import { Badge, Alert, Button, Spinner, type Tone } from '../../../../components/ui';

const STATUS_TONE: Record<string, Tone> = {
  DRAFT: 'neutral',
  PENDING_REVIEW: 'warning',
  PUBLISHED: 'success',
  REJECTED: 'error',
  SUSPENDED: 'error',
  ARCHIVED: 'neutral',
};

interface OwnProduct {
  id: string;
  title: string;
  description: string | null;
  sku: string;
  barcode: string | null;
  categoryId: string;
  brand: string | null;
  status: string;
  priceMinor: number;
  salePriceMinor: number | null;
  weightGrams: number | null;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  featured: boolean;
  metaTitle: string | null;
  metaDescription: string | null;
  rejectionReason: string | null;
  tags: string[];
}

const dollars = (c: number | null) => (c == null ? '' : (c / 100).toString());
const str = (n: number | null) => (n == null ? '' : String(n));

export default function EditProductPage() {
  const { id } = useParams<{ id: string }>();
  const [initial, setInitial] = useState<ProductValues | null>(null);
  const [status, setStatus] = useState('');
  const [rejection, setRejection] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const p = await api.get<OwnProduct>(`/vendor/products/${id}`);
      setStatus(p.status);
      setRejection(p.rejectionReason);
      setInitial({
        id: p.id,
        title: p.title,
        description: p.description ?? '',
        sku: p.sku,
        barcode: p.barcode ?? '',
        categoryId: p.categoryId,
        brand: p.brand ?? '',
        price: dollars(p.priceMinor),
        salePrice: dollars(p.salePriceMinor),
        weightGrams: str(p.weightGrams),
        lengthMm: str(p.lengthMm),
        widthMm: str(p.widthMm),
        heightMm: str(p.heightMm),
        featured: p.featured,
        tags: p.tags.join(', '),
        metaTitle: p.metaTitle ?? '',
        metaDescription: p.metaDescription ?? '',
      });
    } catch (e) {
      setErr((e as ApiError).message ?? 'Not found.');
    }
  }
  useEffect(() => {
    void load();
  }, [id]);

  async function act(action: 'archive' | 'unarchive') {
    try {
      await api.post(`/vendor/products/${id}/${action}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Action failed.');
    }
  }

  if (err) return <Alert tone="error">{err}</Alert>;
  if (!initial) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/products" className="text-sm font-medium text-belize-blue hover:underline">← My Products</Link>
      <div className="mb-6 mt-2 flex items-center justify-between gap-3">
        <h1 className="bmpl-page-title">Edit product</h1>
        <Badge tone={STATUS_TONE[status] ?? 'neutral'}>{status.replace('_', ' ')}</Badge>
      </div>

      {status === 'PUBLISHED' && (
        <Alert tone="success" className="mb-4">
          This product is live on your storefront. Changes save instantly.
        </Alert>
      )}
      {status === 'SUSPENDED' && (
        <Alert tone="error" className="mb-4">
          This product was suspended by an administrator.{rejection ? ` Reason: ${rejection}` : ''}
        </Alert>
      )}

      <div className="mb-5 flex gap-2">
        {status !== 'ARCHIVED' && status !== 'SUSPENDED' && (
          <Button variant="outline" size="sm" onClick={() => act('archive')}>
            Archive (hide from store)
          </Button>
        )}
        {status === 'ARCHIVED' && (
          <Button size="sm" onClick={() => act('unarchive')}>
            Publish to store
          </Button>
        )}
      </div>

      <div className="mb-6">
        <ImageManager productId={id} />
      </div>

      <div className="mb-6">
        <VariantsInventory productId={id} />
      </div>

      <ProductForm initial={initial} />
    </div>
  );
}
