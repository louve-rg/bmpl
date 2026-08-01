'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui';
import type { InvRow, ProductImage, Variant } from './types';
import { asApiError, centsToDollars, dollarsToCents, fieldError, SaveState, smallInput } from './shared';
import { ImageGallery, type VariantChoice } from './ImageGallery';
import { computeInventoryAdjustment, reasonForMode, type AdjustMode } from './inventory-adjust';

type FieldKey = 'displayName' | 'sku' | 'barcode' | 'price' | 'salePrice';
type Status = 'idle' | 'saving' | 'saved' | 'error';

interface Props {
  productId: string;
  variant: Variant;
  invRow?: InvRow;
  images: ProductImage[];
  variantChoices: VariantChoice[];
  moveImage: (imageId: string, dir: -1 | 1) => void | Promise<void>;
  reloadVariants: () => Promise<void>;
  reloadImages: () => Promise<void>;
  onError: (msg: string) => void;
}

export function VariantCard({
  productId,
  variant,
  invRow,
  images,
  variantChoices,
  moveImage,
  reloadVariants,
  reloadImages,
  onError,
}: Props) {
  const [fields, setFields] = useState<Record<FieldKey, string>>({
    displayName: variant.displayName ?? '',
    sku: variant.sku ?? '',
    barcode: variant.barcode ?? '',
    price: centsToDollars(variant.priceMinor),
    salePrice: centsToDollars(variant.salePriceMinor),
  });
  const [status, setStatus] = useState<Record<FieldKey, Status>>({
    displayName: 'idle', sku: 'idle', barcode: 'idle', price: 'idle', salePrice: 'idle',
  });
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [confirmDel, setConfirmDel] = useState(false);

  const set = (k: FieldKey, v: string) => setFields((p) => ({ ...p, [k]: v }));
  const setStat = (k: FieldKey, s: Status) => setStatus((p) => ({ ...p, [k]: s }));

  async function saveField(k: FieldKey, apiKey: string, value: unknown, unchanged: boolean) {
    if (unchanged) return;
    setStat(k, 'saving');
    setErrors((p) => ({ ...p, [k]: undefined }));
    try {
      await api.patch(`/vendor/products/${productId}/variants/${variant.id}`, { [apiKey]: value });
      setStat(k, 'saved');
      await reloadVariants();
      setTimeout(() => setStat(k, 'idle'), 1500);
    } catch (e) {
      const err = asApiError(e);
      setStat(k, 'error');
      setErrors((p) => ({ ...p, [k]: fieldError(err, apiKey) }));
    }
  }

  const price = dollarsToCents(fields.price);
  const salePrice = dollarsToCents(fields.salePrice);

  return (
    <div className={`rounded-bmpl-lg border p-4 ${variant.isActive ? 'border-slate-200' : 'border-slate-200 bg-slate-50/60'}`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h4 className="text-sm font-bold text-belize-navy">{variant.title}</h4>
          {!variant.isActive && <Badge tone="neutral">Inactive</Badge>}
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={async () => {
              try {
                await api.patch(`/vendor/products/${productId}/variants/${variant.id}`, { isActive: !variant.isActive });
                await reloadVariants();
              } catch (e) {
                onError(asApiError(e).message);
              }
            }}
            role="switch"
            aria-checked={variant.isActive}
            className={`inline-flex items-center gap-1.5 text-xs font-semibold ${variant.isActive ? 'text-emerald-600' : 'text-slate-400'}`}
          >
            <span className={`relative h-4 w-7 rounded-full transition ${variant.isActive ? 'bg-emerald-500' : 'bg-slate-300'}`}>
              <span className={`absolute top-0.5 h-3 w-3 rounded-full bg-white transition ${variant.isActive ? 'left-3.5' : 'left-0.5'}`} />
            </span>
            {variant.isActive ? 'Active' : 'Inactive'}
          </button>
          {confirmDel ? (
            <span className="inline-flex items-center gap-2">
              <button
                type="button"
                onClick={async () => {
                  try {
                    await api.del(`/vendor/products/${productId}/variants/${variant.id}`);
                    await Promise.all([reloadVariants(), reloadImages()]);
                  } catch (e) {
                    onError(asApiError(e).message);
                  }
                }}
                className="rounded-bmpl-sm bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700"
              >
                Confirm delete
              </button>
              <button type="button" onClick={() => setConfirmDel(false)} className="text-xs font-semibold text-slate-500 hover:underline">
                Cancel
              </button>
            </span>
          ) : (
            <button type="button" onClick={() => setConfirmDel(true)} className="text-xs font-semibold text-red-600 hover:underline">
              Delete
            </button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <FieldBlock label="Display name" status={status.displayName} error={errors.displayName} hint="Leave blank to use the option label.">
          <input
            className={`${smallInput} w-full`}
            value={fields.displayName}
            placeholder={variant.optionLabel ?? variant.title}
            onChange={(e) => set('displayName', e.target.value)}
            onBlur={() => void saveField('displayName', 'displayName', fields.displayName, fields.displayName === (variant.displayName ?? ''))}
          />
        </FieldBlock>

        <FieldBlock label="SKU" status={status.sku} error={errors.sku}>
          <input
            className={`${smallInput} w-full`}
            value={fields.sku}
            onChange={(e) => set('sku', e.target.value)}
            onBlur={() => void saveField('sku', 'sku', fields.sku.trim() || null, fields.sku === (variant.sku ?? ''))}
          />
        </FieldBlock>

        <FieldBlock label="Price (BZD)" status={status.price} error={errors.price} hint="Blank inherits the product price.">
          <input
            className={`${smallInput} w-full`}
            inputMode="decimal"
            placeholder="0.00"
            value={fields.price}
            onChange={(e) => set('price', e.target.value)}
            onBlur={() => void saveField('price', 'priceMinor', price, price === variant.priceMinor)}
          />
        </FieldBlock>

        <FieldBlock label="Sale price (BZD)" status={status.salePrice} error={errors.salePrice} hint="Optional. Blank clears the sale.">
          <input
            className={`${smallInput} w-full`}
            inputMode="decimal"
            placeholder="0.00"
            value={fields.salePrice}
            onChange={(e) => set('salePrice', e.target.value)}
            onBlur={() => void saveField('salePrice', 'salePriceMinor', salePrice, salePrice === variant.salePriceMinor)}
          />
        </FieldBlock>

        <FieldBlock label="Barcode" status={status.barcode} error={errors.barcode}>
          <input
            className={`${smallInput} w-full`}
            value={fields.barcode}
            onChange={(e) => set('barcode', e.target.value)}
            onBlur={() => void saveField('barcode', 'barcode', fields.barcode.trim() || null, fields.barcode === (variant.barcode ?? ''))}
          />
        </FieldBlock>

        <InventoryField productId={productId} variant={variant} invRow={invRow} reloadVariants={reloadVariants} onError={onError} />
      </div>

      <div className="mt-4 border-t border-slate-100 pt-3">
        <p className="bmpl-label mb-2">Images for this variant</p>
        <ImageGallery
          productId={productId}
          variantId={variant.id}
          images={images}
          variantChoices={variantChoices}
          move={moveImage}
          onMutate={reloadImages}
          onError={onError}
        />
      </div>
    </div>
  );
}

function FieldBlock({
  label,
  status,
  error,
  hint,
  children,
}: {
  label: string;
  status?: Status;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="bmpl-label mb-0">{label}</span>
        {status && <SaveState state={status} />}
      </div>
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-400">{hint}</p>}
      {error && <p className="mt-1 text-xs font-medium text-red-600">{error}</p>}
    </div>
  );
}

function InventoryField({
  productId,
  variant,
  invRow,
  reloadVariants,
  onError,
}: {
  productId: string;
  variant: Variant;
  invRow?: InvRow;
  reloadVariants: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<AdjustMode>('ADD');
  const [qtyStr, setQtyStr] = useState('1');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const q = `?variantId=${variant.id}`;
  const unlimited = invRow?.unlimited ?? false;
  const current = variant.quantity;
  const reserved = invRow?.reserved ?? 0;
  const qty = qtyStr.trim() === '' ? 0 : Number(qtyStr);
  const plan = computeInventoryAdjustment(mode, Number.isFinite(qty) ? qty : -1, current);

  async function run(p: Promise<unknown>) {
    setBusy(true);
    try {
      await p;
      await reloadVariants();
    } catch (e) {
      onError(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  function apply() {
    // Guard prevents accidental double submission (button is also disabled while busy).
    if (busy || unlimited || !plan.valid) return;
    void run(
      api.post(`/vendor/products/${productId}/inventory/adjust${q}`, {
        delta: plan.delta,
        reason: reasonForMode(mode),
      }),
    ).then(() => setQtyStr(mode === 'SET' ? String(plan.result) : '1'));
  }

  function bump(step: 1 | -1) {
    const base = Number.isFinite(qty) ? qty : 0;
    setQtyStr(String(Math.max(0, base + step)));
  }

  const MODES: Array<{ key: AdjustMode; label: string }> = [
    { key: 'ADD', label: 'Add' },
    { key: 'REMOVE', label: 'Remove' },
    { key: 'SET', label: 'Set' },
  ];

  return (
    <div className="sm:col-span-2">
      <div className="mb-1 flex items-center justify-between">
        <span className="bmpl-label mb-0">Inventory</span>
        <span className="text-xs text-slate-400">
          On hand: <span className="font-semibold text-belize-navy">{unlimited ? '∞' : current}</span>
          {!unlimited && reserved > 0 && <span className="ml-2">Reserved: {reserved}</span>}
        </span>
      </div>

      {unlimited ? (
        <p className="text-xs text-slate-400">Unlimited stock — quantity tracking is off for this variant.</p>
      ) : (
        <div className="rounded-bmpl-md border border-slate-200 p-2">
          {/* Adjustment type — no minus sign needed on mobile */}
          <div className="flex gap-1" role="group" aria-label="Adjustment type">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                aria-pressed={mode === m.key}
                disabled={busy}
                onClick={() => setMode(m.key)}
                className={`flex-1 rounded-bmpl-sm px-2 py-2 text-xs font-semibold transition ${
                  mode === m.key ? 'bg-belize-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>

          {/* Quantity stepper — big tap targets + numeric keypad */}
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              aria-label="Decrease amount"
              disabled={busy || qty <= 0}
              onClick={() => bump(-1)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md border border-slate-300 text-xl leading-none text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              −
            </button>
            <input
              className={`${smallInput} h-11 flex-1 text-center text-base`}
              inputMode="numeric"
              pattern="[0-9]*"
              value={qtyStr}
              disabled={busy}
              onChange={(e) => setQtyStr(e.target.value.replace(/[^0-9]/g, ''))}
              aria-label={`Quantity to ${mode.toLowerCase()}`}
            />
            <button
              type="button"
              aria-label="Increase amount"
              disabled={busy}
              onClick={() => bump(1)}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md border border-slate-300 text-xl leading-none text-slate-600 transition hover:bg-slate-50 disabled:opacity-40"
            >
              +
            </button>
          </div>

          {/* Live result preview / inline validation */}
          <p className={`mt-2 text-xs ${plan.valid ? 'text-slate-500' : 'text-red-600'}`} role="status">
            {plan.valid ? <>New on-hand: <span className="font-semibold text-belize-navy">{plan.result}</span></> : plan.error}
          </p>

          <button
            type="button"
            disabled={busy || !plan.valid}
            onClick={apply}
            className="mt-2 w-full rounded-bmpl-md bg-belize-blue px-3 py-2.5 text-sm font-semibold text-white transition hover:bg-belize-deep disabled:opacity-50 sm:w-auto sm:px-4"
          >
            {busy ? 'Applying…' : 'Apply adjustment'}
          </button>
        </div>
      )}

      {invRow && (
        <button type="button" onClick={() => setOpen((v) => !v)} className="mt-2 text-xs font-semibold text-belize-blue hover:underline">
          {open ? 'Hide settings' : 'Stock settings'}
        </button>
      )}
      {invRow && open && (
        <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-bmpl-md bg-slate-50 p-2.5">
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={invRow.unlimited} onChange={(e) => void run(api.patch(`/vendor/products/${productId}/inventory${q}`, { unlimited: e.target.checked }))} />
            Unlimited stock
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={invRow.allowBackorders} onChange={(e) => void run(api.patch(`/vendor/products/${productId}/inventory${q}`, { allowBackorders: e.target.checked }))} />
            Allow backorders
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Low-stock ≤
            <input
              className={`${smallInput} w-16`}
              inputMode="numeric"
              defaultValue={invRow.lowStockThreshold}
              onBlur={(e) => Number(e.target.value) !== invRow.lowStockThreshold && void run(api.patch(`/vendor/products/${productId}/inventory${q}`, { lowStockThreshold: Number(e.target.value) }))}
            />
          </label>
        </div>
      )}
    </div>
  );
}
