'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import { Badge } from '../ui';
import type { InvRow, LocationStock } from './types';
import { asApiError, smallInput } from './shared';
import { computeInventoryAdjustment, reasonForMode, type AdjustMode } from './inventory-adjust';

/**
 * The inventory adjust/settings/per-location workflow, extracted so it can
 * target either a variant's own row (VariantCard's InventoryField, via
 * `?variantId=`) or a product's own row when the product has no options at
 * all (ProductInventoryCard, via no query param) — the API already treats
 * both the same way (variantId is optional on every /inventory route; omit
 * it to target the product-level row), so this was a frontend gap, not a
 * backend one (MDF-226). Byte-for-byte the same control either way.
 */
export function InventoryControl({
  productId,
  query,
  invRow,
  currentQty,
  onChanged,
  onError,
}: {
  productId: string;
  /** `''` for the product-level row, `?variantId=<id>` for a variant's row. */
  query: string;
  invRow?: InvRow;
  /** Current on-hand, from whichever resource already fetched it. */
  currentQty: number;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<AdjustMode>('ADD');
  const [qtyStr, setQtyStr] = useState('1');
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [locOpen, setLocOpen] = useState(false);
  const [locs, setLocs] = useState<LocationStock[] | null>(null);
  const [locErr, setLocErr] = useState<string | null>(null);
  const unlimited = invRow?.unlimited ?? false;
  // BMPL-372: once this product has adopted per-location tracking, the
  // server refuses this control's own endpoint rather than silently writing
  // a number checkout no longer reads — so the control must not be offered
  // at all, with a reason, rather than shown and left to fail.
  const hasLocations = invRow?.hasLocations ?? false;
  const current = currentQty;
  const reserved = invRow?.reserved ?? 0;
  const qty = qtyStr.trim() === '' ? 0 : Number(qtyStr);
  const plan = computeInventoryAdjustment(mode, Number.isFinite(qty) ? qty : -1, current);

  async function run(p: Promise<unknown>) {
    setBusy(true);
    try {
      await p;
      await onChanged();
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
      api.post(`/vendor/products/${productId}/inventory/adjust${query}`, {
        delta: plan.delta,
        reason: reasonForMode(mode),
      }),
    ).then(() => setQtyStr(mode === 'SET' ? String(plan.result) : '1'));
  }

  function bump(step: 1 | -1) {
    const base = Number.isFinite(qty) ? qty : 0;
    setQtyStr(String(Math.max(0, base + step)));
  }

  async function loadLocations() {
    try {
      setLocErr(null);
      setLocs(await api.get<LocationStock[]>(`/vendor/products/${productId}/inventory/locations${query}`));
    } catch (e) {
      setLocErr(asApiError(e).message);
    }
  }

  function toggleLocations() {
    const next = !locOpen;
    setLocOpen(next);
    if (next && locs === null) void loadLocations();
  }

  async function onLocationAdjusted() {
    await Promise.all([onChanged(), loadLocations()]);
  }

  const MODES: Array<{ key: AdjustMode; label: string }> = [
    { key: 'ADD', label: 'Add' },
    { key: 'REMOVE', label: 'Remove' },
    { key: 'SET', label: 'Set' },
  ];

  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="bmpl-label mb-0">Inventory</span>
        <span className="text-xs text-slate-400">
          On hand: <span className="font-semibold text-belize-navy">{unlimited ? '∞' : current}</span>
          {!unlimited && reserved > 0 && <span className="ml-2">Reserved: {reserved}</span>}
        </span>
      </div>

      {unlimited ? (
        <p className="text-xs text-slate-400">Unlimited stock — quantity tracking is off.</p>
      ) : hasLocations ? (
        <p className="text-xs text-slate-500">This product tracks stock per location — adjust it there.</p>
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md border border-[color:var(--bmpl-border)] text-xl leading-none text-[color:var(--bmpl-text-muted)] transition hover:bg-[color:var(--bmpl-surface-muted)] disabled:opacity-40"
            >
              −
            </button>
            <input
              className={`${smallInput} h-11 min-w-0 flex-1 text-center text-base`}
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
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-bmpl-md border border-[color:var(--bmpl-border)] text-xl leading-none text-[color:var(--bmpl-text-muted)] transition hover:bg-[color:var(--bmpl-surface-muted)] disabled:opacity-40"
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
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={invRow.unlimited} onChange={(e) => void run(api.patch(`/vendor/products/${productId}/inventory${query}`, { unlimited: e.target.checked }))} />
            Unlimited stock
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            <input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={invRow.allowBackorders} onChange={(e) => void run(api.patch(`/vendor/products/${productId}/inventory${query}`, { allowBackorders: e.target.checked }))} />
            Allow backorders
          </label>
          <label className="flex items-center gap-1.5 text-xs text-slate-600">
            Low-stock ≤
            <input
              className={`${smallInput} w-16`}
              inputMode="numeric"
              defaultValue={invRow.lowStockThreshold}
              onBlur={(e) => Number(e.target.value) !== invRow.lowStockThreshold && void run(api.patch(`/vendor/products/${productId}/inventory${query}`, { lowStockThreshold: Number(e.target.value) }))}
            />
          </label>
        </div>
      )}

      {/* Per-location stock (BMPL-175/354). Unlimited stock isn't tracked
          anywhere, product-level or per-location, so there is nothing to
          break down when it's on. */}
      {!unlimited && (
        <button type="button" onClick={toggleLocations} className="mt-2 ml-3 text-xs font-semibold text-belize-blue hover:underline">
          {locOpen ? 'Hide stock by location' : 'Stock by location'}
        </button>
      )}
      {!unlimited && locOpen && (
        <div className="mt-2 space-y-2">
          {locErr && <p className="text-xs font-medium text-red-600">{locErr}</p>}
          {locs === null && !locErr && <p className="text-xs text-slate-400">Loading locations…</p>}
          {locs && locs.length <= 1 && <p className="text-xs text-slate-400">Only one location — nothing to split.</p>}
          {locs &&
            locs.length > 1 &&
            locs.map((loc) => (
              <LocationRow key={loc.locationId} productId={productId} variantQuery={query} loc={loc} onChanged={onLocationAdjusted} onError={onError} />
            ))}
        </div>
      )}
    </div>
  );
}

/** One vendor location's stock, inside an "Stock by location" breakdown —
 *  same Add/Remove/Set maths as the editor above (computeInventoryAdjustment),
 *  posted to the location-scoped adjust endpoint instead of the product/variant
 *  one. */
function LocationRow({
  productId,
  variantQuery,
  loc,
  onChanged,
  onError,
}: {
  productId: string;
  variantQuery: string;
  loc: LocationStock;
  onChanged: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<AdjustMode>('ADD');
  const [qtyStr, setQtyStr] = useState('1');
  const [busy, setBusy] = useState(false);
  const qty = qtyStr.trim() === '' ? 0 : Number(qtyStr);
  const plan = computeInventoryAdjustment(mode, Number.isFinite(qty) ? qty : -1, loc.quantity);

  async function apply() {
    if (busy || !plan.valid) return;
    setBusy(true);
    try {
      await api.post(`/vendor/products/${productId}/inventory/locations/${loc.locationId}/adjust${variantQuery}`, {
        delta: plan.delta,
        reason: reasonForMode(mode),
      });
      setQtyStr(mode === 'SET' ? String(plan.result) : '1');
      await onChanged();
    } catch (e) {
      onError(asApiError(e).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-bmpl-md border border-slate-200 p-2">
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs font-semibold text-belize-navy">
          {loc.label}
          {loc.isPrimary && <Badge tone="neutral">Primary</Badge>}
        </span>
        <span className="text-xs text-slate-400">
          On hand: <span className="font-semibold text-belize-navy">{loc.quantity}</span>
          {loc.reserved > 0 && <span className="ml-2">Reserved: {loc.reserved}</span>}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <div className="flex gap-1" role="group" aria-label={`Adjustment type for ${loc.label}`}>
          {(['ADD', 'REMOVE', 'SET'] as const).map((m) => (
            <button
              key={m}
              type="button"
              aria-pressed={mode === m}
              disabled={busy}
              onClick={() => setMode(m)}
              className={`rounded-bmpl-sm px-2 py-1 text-xs font-semibold transition ${
                mode === m ? 'bg-belize-blue text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
              }`}
            >
              {m === 'ADD' ? 'Add' : m === 'REMOVE' ? 'Remove' : 'Set'}
            </button>
          ))}
        </div>
        <input
          className={`${smallInput} h-8 w-16 text-center text-sm`}
          inputMode="numeric"
          pattern="[0-9]*"
          value={qtyStr}
          disabled={busy}
          onChange={(e) => setQtyStr(e.target.value.replace(/[^0-9]/g, ''))}
          aria-label={`Quantity to ${mode.toLowerCase()} at ${loc.label}`}
        />
        <button
          type="button"
          disabled={busy || !plan.valid}
          onClick={apply}
          className="rounded-bmpl-md bg-belize-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-belize-deep disabled:opacity-50"
        >
          {busy ? 'Applying…' : 'Apply'}
        </button>
      </div>
      <p className={`mt-1 text-xs ${plan.valid ? 'text-slate-500' : 'text-red-600'}`} role="status">
        {plan.valid ? <>New on-hand: <span className="font-semibold text-belize-navy">{plan.result}</span></> : plan.error}
      </p>
    </div>
  );
}
