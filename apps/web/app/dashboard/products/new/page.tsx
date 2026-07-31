'use client';

import Link from 'next/link';
import { ProductForm } from '../ProductForm';
import { PageHeader } from '../../../../components/ui';

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/products" className="text-sm font-medium text-belize-blue hover:underline">
        ← My Products
      </Link>
      <div className="mt-2">
        <PageHeader title="New product" />
      </div>
      <ProductForm />
    </div>
  );
}
