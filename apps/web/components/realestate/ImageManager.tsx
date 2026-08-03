'use client';

import { useState } from 'react';
import { MAX_PROPERTY_IMAGES } from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import type { ManagedProperty } from '../../lib/realestate';
import { Alert, Badge, Button, Card } from '../ui';

interface ImageLister {
  uploadImage: (
    id: string,
    file: File,
    meta?: { altText?: string; caption?: string; areaLabel?: string },
  ) => Promise<ManagedProperty>;
  setPrimaryImage: (id: string, imageId: string) => Promise<ManagedProperty>;
  reorderImages: (id: string, imageIds: string[]) => Promise<ManagedProperty>;
  deleteImage: (id: string, imageId: string) => Promise<ManagedProperty>;
}

/** Manage a listing's photos: upload (presign→PUT→confirm), set primary, reorder, delete. */
export function ImageManager({
  lister,
  listing,
  onChanged,
}: {
  lister: ImageLister;
  listing: ManagedProperty;
  onChanged: (updated: ManagedProperty) => void;
}) {
  const images = listing.images;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const atMax = images.length >= MAX_PROPERTY_IMAGES;

  async function run(fn: () => Promise<ManagedProperty>) {
    setError(null);
    setBusy(true);
    try {
      onChanged(await fn());
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function upload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setBusy(true);
    try {
      let latest = listing;
      for (const file of Array.from(files)) {
        if (latest.images.length >= MAX_PROPERTY_IMAGES) break;
        latest = await lister.uploadImage(listing.id, file);
      }
      onChanged(latest);
    } catch (e) {
      setError((e as ApiError).message ?? 'Upload failed.');
    } finally {
      setBusy(false);
    }
  }

  function move(index: number, dir: -1 | 1) {
    const ids = images.map((i) => i.id);
    const target = index + dir;
    if (target < 0 || target >= ids.length) return;
    const a = ids[index];
    const b = ids[target];
    if (a === undefined || b === undefined) return;
    ids[index] = b;
    ids[target] = a;
    void run(() => lister.reorderImages(listing.id, ids));
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="bmpl-eyebrow">Photos</h2>
        <Badge tone={atMax ? 'warning' : 'neutral'}>
          {images.length} / {MAX_PROPERTY_IMAGES}
        </Badge>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      <div>
        <input
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          disabled={busy || atMax}
          onChange={(e) => upload(e.target.files)}
          className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue disabled:opacity-60"
        />
        {atMax && <p className="mt-1 text-xs text-amber-600">Maximum number of images reached.</p>}
      </div>

      {images.length === 0 ? (
        <p className="text-sm text-slate-400">No photos yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {images.map((img, i) => (
            <div key={img.id} className="group relative overflow-hidden rounded-bmpl-md border border-slate-200">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={img.url ?? ''} alt={img.altText ?? ''} className="aspect-[4/3] w-full object-cover" />
              {img.isPrimary && (
                <div className="absolute left-1.5 top-1.5">
                  <Badge tone="brand">Primary</Badge>
                </div>
              )}
              <div className="flex items-center justify-between gap-1 bg-white p-1.5 text-xs">
                <div className="flex gap-1">
                  <button type="button" disabled={busy || i === 0} onClick={() => move(i, -1)} className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Move left">
                    ←
                  </button>
                  <button type="button" disabled={busy || i === images.length - 1} onClick={() => move(i, 1)} className="inline-flex min-h-[36px] min-w-[36px] items-center justify-center rounded text-slate-500 hover:bg-slate-100 disabled:opacity-40" aria-label="Move right">
                    →
                  </button>
                </div>
                <div className="flex gap-2">
                  {!img.isPrimary && (
                    <button type="button" disabled={busy} onClick={() => run(() => lister.setPrimaryImage(listing.id, img.id))} className="font-medium text-belize-blue hover:underline">
                      Primary
                    </button>
                  )}
                  <button type="button" disabled={busy} onClick={() => run(() => lister.deleteImage(listing.id, img.id))} className="font-medium text-red-600 hover:underline">
                    Delete
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
