'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import type { ManageView } from './types';
import { asApiError, smallInput } from './shared';

interface Props {
  view: ManageView;
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}

export function VariantBuilder({ view, productId, reload, onError }: Props) {
  if (view.options.length === 0) return null;

  return (
    <section className="rounded-bmpl-md border border-slate-200 bg-slate-50/60 p-3 sm:p-4">
      <h3 className="bmpl-label mb-1">Create variants</h3>
      <p className="mb-3 text-xs text-slate-400">
        Combine existing option values into variants. To add a new value (e.g. a new colour), use the Options section above.
      </p>
      <GenerateAll productId={productId} reload={reload} onError={onError} />
      <div className="my-3 flex items-center gap-3 text-xs text-slate-400">
        <span className="h-px flex-1 bg-slate-200" />
        or add one manually
        <span className="h-px flex-1 bg-slate-200" />
      </div>
      <ManualBuilder view={view} productId={productId} reload={reload} />
    </section>
  );
}

function GenerateAll({
  productId,
  reload,
  onError,
}: {
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [qty, setQty] = useState('0');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setMsg(null);
          try {
            const res = await api.post<{ created: number }>(`/vendor/products/${productId}/variants/generate`, {
              quantity: Number(qty) || 0,
            });
            await reload();
            setMsg(res.created > 0 ? `Created ${res.created} variant${res.created === 1 ? '' : 's'}.` : 'All combinations already exist.');
          } catch (e) {
            onError(asApiError(e).message);
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-bmpl-md bg-belize-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-belize-deep disabled:opacity-50"
      >
        {busy ? 'Generating…' : 'Generate all combinations'}
      </button>
      <label className="flex items-center gap-1.5 text-xs text-slate-500">
        Starting qty
        <input
          className={`${smallInput} w-16`}
          inputMode="numeric"
          value={qty}
          onChange={(e) => setQty(e.target.value)}
          aria-label="Starting quantity for generated variants"
        />
      </label>
      {msg && <span className="text-xs font-medium text-emerald-600">{msg}</span>}
    </div>
  );
}

function ManualBuilder({
  view,
  productId,
  reload,
}: {
  view: ManageView;
  productId: string;
  reload: () => Promise<void>;
}) {
  const [sel, setSel] = useState<Record<string, string>>({});
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState('0');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  return (
    <form
      className="flex flex-wrap items-end gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        setErr(null);
        const optionValueIds = view.options.map((o) => sel[o.id]).filter(Boolean) as string[];
        if (optionValueIds.length !== view.options.length) {
          setErr('Pick one value for every option.');
          return;
        }
        setBusy(true);
        try {
          await api.post(`/vendor/products/${productId}/variants`, {
            optionValueIds,
            sku: sku.trim() || undefined,
            quantity: Number(qty) || 0,
          });
          // Success — clear the builder for the next entry.
          setSel({});
          setSku('');
          setQty('0');
          await reload();
        } catch (ex) {
          // Keep entered SKU/qty/selection so nothing is lost on a duplicate/validation error.
          setErr(asApiError(ex).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      {view.options.map((o) => (
        <label key={o.id} className="flex flex-col gap-1 text-xs text-slate-500">
          {o.name}
          <select
            className={`${smallInput} min-w-[7rem]`}
            value={sel[o.id] ?? ''}
            onChange={(e) => setSel({ ...sel, [o.id]: e.target.value })}
            aria-label={`Select ${o.name}`}
          >
            <option value="">Choose…</option>
            {o.values.map((v) => (
              <option key={v.id} value={v.id}>
                {v.value}
              </option>
            ))}
          </select>
        </label>
      ))}
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        SKU
        <input className={`${smallInput} w-28`} placeholder="Optional" value={sku} onChange={(e) => setSku(e.target.value)} />
      </label>
      <label className="flex flex-col gap-1 text-xs text-slate-500">
        Qty
        <input className={`${smallInput} w-16`} inputMode="numeric" value={qty} onChange={(e) => setQty(e.target.value)} />
      </label>
      <button
        type="submit"
        disabled={busy}
        className="rounded-bmpl-md bg-belize-navy px-3 py-2 text-xs font-semibold text-white transition hover:bg-belize-navy/90 disabled:opacity-50"
      >
        {busy ? 'Adding…' : 'Add variant'}
      </button>
      {err && <p className="w-full text-xs font-medium text-red-600">{err}</p>}
    </form>
  );
}
