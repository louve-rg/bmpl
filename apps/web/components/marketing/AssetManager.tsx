'use client';

import { useState } from 'react';
import {
  IMAGE_ASSET_KINDS,
  PROMOTION_ASSET_KIND_LABELS,
  MAX_PROMOTION_ASSETS,
  type PromotionAssetKind,
} from '@bmpl/shared';
import { type ApiError } from '../../lib/api';
import { marketingApi, type PromotionDetail } from '../../lib/marketing';
import { Alert, Badge, Button, Card, Field, Input, Select } from '../ui';

/**
 * Manage a promotion's creative assets: upload images (presign → PUT → confirm), add a
 * video-placeholder URL, and delete. Only editable statuses accept changes — the caller
 * decides whether to render this. Emits the updated promotion on every change.
 */
export function AssetManager({
  promotion,
  onChanged,
  disabled,
}: {
  promotion: PromotionDetail;
  onChanged: (updated: PromotionDetail) => void;
  disabled?: boolean;
}) {
  const assets = promotion.assets;
  const atMax = assets.length >= MAX_PROMOTION_ASSETS;
  const [kind, setKind] = useState<PromotionAssetKind>('DESKTOP_BANNER');
  const [altText, setAltText] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(fn: () => Promise<PromotionDetail>) {
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
    const file = files?.[0];
    if (!file) return;
    await run(() => marketingApi.uploadAsset(promotion.id, kind, file, altText || undefined));
    setAltText('');
  }

  async function addVideo() {
    if (!videoUrl.trim()) return;
    await run(() => marketingApi.confirmVideoAsset(promotion.id, videoUrl.trim(), altText || undefined));
    setVideoUrl('');
    setAltText('');
  }

  return (
    <Card className="space-y-4 p-5">
      <div className="flex items-center justify-between">
        <h2 className="bmpl-eyebrow">Creative assets</h2>
        <Badge tone={atMax ? 'warning' : 'neutral'}>
          {assets.length} / {MAX_PROMOTION_ASSETS}
        </Badge>
      </div>
      {error && <Alert tone="error">{error}</Alert>}

      {!disabled && (
        <div className="space-y-3 rounded-bmpl-md border border-slate-200 bg-slate-50 p-3">
          <Field label="Asset kind">
            <Select value={kind} onChange={(e) => setKind(e.target.value as PromotionAssetKind)}>
              {IMAGE_ASSET_KINDS.map((k) => (
                <option key={k} value={k}>
                  {PROMOTION_ASSET_KIND_LABELS[k]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Alt text (optional)" hint="Describes the image for accessibility.">
            <Input value={altText} onChange={(e) => setAltText(e.target.value)} maxLength={200} />
          </Field>
          <div>
            <input
              type="file"
              aria-label="Upload image asset"
              accept="image/png,image/jpeg,image/webp"
              disabled={busy || atMax}
              onChange={(e) => upload(e.target.files)}
              className="block w-full text-xs text-slate-600 file:mr-3 file:rounded-md file:border-0 file:bg-belize-blue/10 file:px-3 file:py-1.5 file:text-belize-blue disabled:opacity-60"
            />
            {atMax && <p className="mt-1 text-xs text-amber-600">Maximum number of assets reached.</p>}
          </div>

          <div className="border-t border-slate-200 pt-3">
            <Field label="Video placeholder URL (optional)" hint="Adds a VIDEO_PLACEHOLDER asset referencing a hosted video.">
              <div className="flex gap-2">
                <Input
                  value={videoUrl}
                  onChange={(e) => setVideoUrl(e.target.value)}
                  placeholder="https://…"
                  disabled={busy || atMax}
                />
                <Button type="button" size="sm" variant="outline" disabled={busy || atMax || !videoUrl.trim()} onClick={addVideo}>
                  Add
                </Button>
              </div>
            </Field>
          </div>
        </div>
      )}

      {assets.length === 0 ? (
        <p className="text-sm text-slate-400">No assets yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {assets.map((a) => (
            <div key={a.id} className="group relative overflow-hidden rounded-bmpl-md border border-slate-200">
              {a.url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={a.url} alt={a.altText ?? ''} className="aspect-[4/3] w-full object-cover" />
              ) : (
                <div className="flex aspect-[4/3] w-full items-center justify-center bg-slate-100 px-2 text-center text-xs text-slate-500">
                  {a.videoUrl ? 'Video placeholder' : 'No preview'}
                </div>
              )}
              <div className="flex items-center justify-between gap-1 bg-white p-1.5 text-xs">
                <span className="truncate text-slate-500">{PROMOTION_ASSET_KIND_LABELS[a.kind]}</span>
                {!disabled && (
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => run(() => marketingApi.deleteAsset(promotion.id, a.id))}
                    className="font-medium text-red-600 hover:underline"
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
