'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { Card, Alert, Spinner, EmptyState } from '../ui';
import type { Inventory, ManageView, ProductImage } from './types';
import { asApiError } from './shared';
import { OptionsManager } from './OptionsManager';
import { VariantBuilder } from './VariantBuilder';
import { VariantCard } from './VariantCard';
import { ImageGallery, type VariantChoice } from './ImageGallery';
import { StorefrontPreview } from './StorefrontPreview';

/**
 * Variant-centric product editor (Phase M6.1). Replaces the previous
 * ImageManager + VariantsInventory pair with a single cohesive workflow:
 * Options → Variant builder → per-variant editor cards (each with its own
 * image gallery) → a general (all-variants) gallery → storefront preview.
 */
export function ProductEditorManager({ productId }: { productId: string }) {
  const [view, setView] = useState<ManageView | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [images, setImages] = useState<ProductImage[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [actionErr, setActionErr] = useState<string | null>(null);

  const reloadVariants = useCallback(async () => {
    const [v, i] = await Promise.all([
      api.get<ManageView>(`/vendor/products/${productId}/variants`),
      api.get<Inventory>(`/vendor/products/${productId}/inventory`),
    ]);
    setView(v);
    setInv(i);
  }, [productId]);

  const reloadImages = useCallback(async () => {
    setImages(await api.get<ProductImage[]>(`/vendor/products/${productId}/images`));
  }, [productId]);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [v, i, im] = await Promise.all([
          api.get<ManageView>(`/vendor/products/${productId}/variants`),
          api.get<Inventory>(`/vendor/products/${productId}/inventory`),
          api.get<ProductImage[]>(`/vendor/products/${productId}/images`),
        ]);
        if (!alive) return;
        setView(v);
        setInv(i);
        setImages(im);
      } catch (e) {
        if (alive) setLoadErr(asApiError(e).message);
      }
    })();
    return () => {
      alive = false;
    };
  }, [productId]);

  // Reorder within an image's own group. The API wants the full ordered list of
  // every image id, so we swap the two neighbours inside the global order.
  const moveImage = useCallback(
    async (imageId: string, dir: -1 | 1) => {
      if (!images) return;
      const full = [...images].sort((a, b) => a.position - b.position);
      const target = full.find((x) => x.id === imageId);
      if (!target) return;
      const group = full.filter((x) => x.variantId === target.variantId);
      const gi = group.findIndex((x) => x.id === imageId);
      const neighbour = group[gi + dir];
      if (!neighbour) return;
      const order = full.map((x) => x.id);
      const a = order.indexOf(imageId);
      const b = order.indexOf(neighbour.id);
      [order[a], order[b]] = [order[b]!, order[a]!];
      try {
        await api.post(`/vendor/products/${productId}/images/reorder`, { order });
        await reloadImages();
      } catch (e) {
        setActionErr(asApiError(e).message);
      }
    },
    [images, productId, reloadImages],
  );

  if (loadErr) {
    return (
      <Card className="p-5 sm:p-6">
        <Alert tone="error">{loadErr}</Alert>
      </Card>
    );
  }
  if (!view || !inv || !images) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-slate-500 sm:p-6">
        <Spinner className="h-4 w-4" /> Loading product editor…
      </Card>
    );
  }

  const variantChoices: VariantChoice[] = view.variants.map((v) => ({ id: v.id, label: v.title }));
  const generalImages = images.filter((i) => i.variantId === null).sort((a, b) => a.position - b.position);
  const invByVariant = new Map(inv.variants.map((r) => [r.variantId ?? '', r]));

  return (
    <div className="space-y-6">
      {actionErr && (
        <Alert tone="warning">
          <div className="flex items-start justify-between gap-3">
            <span>{actionErr}</span>
            <button onClick={() => setActionErr(null)} className="text-xs font-semibold underline">
              Dismiss
            </button>
          </div>
        </Alert>
      )}

      {/* Options */}
      <Card className="space-y-4 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Options</h2>
        <OptionsManager view={view} productId={productId} reload={reloadVariants} onError={setActionErr} />
      </Card>

      {/* Variants */}
      <Card className="space-y-4 p-5 sm:p-6">
        <div className="flex items-center justify-between">
          <h2 className="bmpl-eyebrow">Variants</h2>
          {view.variants.length > 0 && <span className="text-xs text-slate-400">{view.variants.length} variant{view.variants.length === 1 ? '' : 's'}</span>}
        </div>

        {view.options.length === 0 ? (
          <EmptyState title="No options yet" description="Add an option like Color or Size above to start building variants." />
        ) : (
          <>
            <VariantBuilder view={view} productId={productId} reload={reloadVariants} onError={setActionErr} />

            {view.variants.length === 0 ? (
              <p className="text-sm text-slate-500">No variants yet — generate all combinations or add one manually above.</p>
            ) : (
              <div className="space-y-4">
                {view.variants.map((variant) => (
                  <VariantCard
                    key={variant.id}
                    productId={productId}
                    variant={variant}
                    invRow={invByVariant.get(variant.id)}
                    images={images.filter((i) => i.variantId === variant.id).sort((a, b) => a.position - b.position)}
                    variantChoices={variantChoices}
                    moveImage={moveImage}
                    reloadVariants={reloadVariants}
                    reloadImages={reloadImages}
                    onError={setActionErr}
                  />
                ))}
              </div>
            )}
          </>
        )}
      </Card>

      {/* General / all-variants gallery */}
      <Card className="space-y-4 p-5 sm:p-6">
        <div>
          <h2 className="bmpl-eyebrow">General images</h2>
          <p className="mt-1 text-xs text-slate-400">
            Shown for the product regardless of the selected variant. {variantChoices.length > 0 && 'Use the dropdown on an image to move it to a specific variant.'}
          </p>
        </div>
        <ImageGallery
          productId={productId}
          variantId={null}
          images={generalImages}
          variantChoices={variantChoices}
          move={moveImage}
          onMutate={reloadImages}
          onError={setActionErr}
        />
      </Card>

      {/* Storefront preview */}
      <Card className="space-y-3 p-5 sm:p-6">
        <h2 className="bmpl-eyebrow">Storefront preview</h2>
        <StorefrontPreview productTitle={view.productTitle} images={images} />
      </Card>
    </div>
  );
}
