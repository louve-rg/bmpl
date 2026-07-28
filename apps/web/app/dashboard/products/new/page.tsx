'use client';

import Link from 'next/link';
import { ProductForm } from '../ProductForm';

export default function NewProductPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <Link href="/dashboard/products" className="text-sm text-belize-blue hover:underline">← My Products</Link>
      <h1 className="mb-6 mt-2 text-2xl font-bold text-belize-navy">New product</h1>
      <ProductForm />
    </div>
  );
}
