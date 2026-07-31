'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Card, Alert, Badge, Spinner, type Tone } from '../../../components/ui';

interface OptionValue { id: string; value: string }
interface Option { id: string; name: string; values: OptionValue[] }
interface Variant {
  id: string;
  sku: string | null;
  priceMinor: number | null;
  isActive: boolean;
  optionValueIds: string[];
  quantity: number;
}
interface ManageView { options: Option[]; variants: Variant[] }
interface InvRow {
  inventoryId: string;
  variantId?: string | null;
  sku?: string | null;
  quantity: number;
  reserved: number;
  available: number | null;
  unlimited: boolean;
  allowBackorders: boolean;
  lowStockThreshold: number;
  inStock: boolean;
  lowStock: boolean;
  outOfStock: boolean;
}
interface Inventory { product: InvRow; variants: InvRow[] }

const money = (c: number | null) => (c == null ? 'inherit' : `$${(c / 100).toFixed(2)}`);

export function VariantsInventory({ productId }: { productId: string }) {
  const [view, setView] = useState<ManageView | null>(null);
  const [inv, setInv] = useState<Inventory | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    try {
      const [v, i] = await Promise.all([
        api.get<ManageView>(`/vendor/products/${productId}/variants`),
        api.get<Inventory>(`/vendor/products/${productId}/inventory`),
      ]);
      setView(v);
      setInv(i);
      setErr(null);
    } catch (e) {
      setErr((e as ApiError).message ?? 'Failed to load.');
    }
  }
  useEffect(() => { void load(); }, [productId]);

  async function run(p: Promise<unknown>) {
    try { await p; await load(); } catch (e) { window.alert((e as ApiError).message ?? 'Action failed.'); }
  }

  if (!view || !inv) {
    return (
      <Card className="flex items-center gap-2 p-5 text-sm text-slate-500 sm:p-6">
        <Spinner className="h-4 w-4" /> Loading variants…
      </Card>
    );
  }

  const valueLabel = (id: string) => {
    for (const o of view.options) { const val = o.values.find((v) => v.id === id); if (val) return `${o.name}: ${val.value}`; }
    return id;
  };

  return (
    <Card className="space-y-6 p-5 sm:p-6">
      <h2 className="bmpl-eyebrow">Variants &amp; Inventory</h2>
      {err && <Alert tone="warning">{err}</Alert>}

      <Options view={view} onRun={run} productId={productId} />
      <Variants view={view} onRun={run} productId={productId} valueLabel={valueLabel} />
      <InventoryPanel inv={inv} hasVariants={view.variants.length > 0} onRun={run} productId={productId} valueLabel={valueLabel} view={view} />
    </Card>
  );
}

const input = 'rounded-bmpl-md border border-slate-300 px-2.5 py-1.5 text-sm outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30';
const btn = 'rounded-bmpl-md bg-belize-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-belize-deep disabled:opacity-50';

function Options({ view, onRun, productId }: { view: ManageView; onRun: (p: Promise<unknown>) => void; productId: string }) {
  const [name, setName] = useState('');
  const [values, setValues] = useState('');
  const locked = view.variants.length > 0;
  return (
    <div>
      <h3 className="bmpl-label mb-2">Options</h3>
      {view.options.map((o) => (
        <div key={o.id} className="mb-1.5 flex flex-wrap items-center gap-2 text-sm">
          <span className="font-medium text-belize-navy">{o.name}:</span>
          {o.values.map((v) => <Badge key={v.id}>{v.value}</Badge>)}
          <AddValue optionId={o.id} productId={productId} onRun={onRun} disabled={locked} />
          {!locked && <button onClick={() => onRun(api.del(`/vendor/products/${productId}/options/${o.id}`))} className="text-xs text-red-600 hover:underline">remove</button>}
        </div>
      ))}
      {locked ? (
        <p className="text-xs text-slate-400">Delete variants to change options.</p>
      ) : (
        <form
          className="mt-2 flex flex-wrap items-center gap-2"
          onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; onRun(api.post(`/vendor/products/${productId}/options`, { name, values: values.split(',').map((s) => s.trim()).filter(Boolean) })); setName(''); setValues(''); }}
        >
          <input className={input} placeholder="Option (e.g. Color)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} placeholder="Values: Red, Blue" value={values} onChange={(e) => setValues(e.target.value)} />
          <button className={btn}>Add option</button>
        </form>
      )}
    </div>
  );
}
function AddValue({ optionId, productId, onRun, disabled }: { optionId: string; productId: string; onRun: (p: Promise<unknown>) => void; disabled: boolean }) {
  const [v, setV] = useState('');
  if (disabled) return null;
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!v.trim()) return; onRun(api.post(`/vendor/products/${productId}/options/${optionId}/values`, { value: v })); setV(''); }}>
      <input className="w-24 rounded-bmpl-sm border border-slate-200 px-1.5 py-0.5 text-xs outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30" placeholder="+ value" value={v} onChange={(e) => setV(e.target.value)} />
    </form>
  );
}

function Variants({ view, onRun, productId, valueLabel }: { view: ManageView; onRun: (p: Promise<unknown>) => void; productId: string; valueLabel: (id: string) => string }) {
  const [sel, setSel] = useState<Record<string, string>>({});
  const [sku, setSku] = useState('');
  const [qty, setQty] = useState('0');
  if (view.options.length === 0) return null;

  return (
    <div>
      <h3 className="bmpl-label mb-2">Variants</h3>
      {view.variants.map((v) => (
        <div key={v.id} className="mb-1.5 flex flex-wrap items-center gap-2 rounded-bmpl-md border border-slate-100 px-2.5 py-1.5 text-sm">
          <span>{v.optionValueIds.map(valueLabel).join(' / ')}</span>
          <span className="text-xs text-slate-400">{v.sku ?? 'no sku'} · {money(v.priceMinor)} · qty {v.quantity}</span>
          <button onClick={() => onRun(api.patch(`/vendor/products/${productId}/variants/${v.id}`, { isActive: !v.isActive }))} className={`text-xs ${v.isActive ? 'text-emerald-600' : 'text-slate-400'} hover:underline`}>{v.isActive ? 'active' : 'inactive'}</button>
          <button onClick={() => onRun(api.del(`/vendor/products/${productId}/variants/${v.id}`))} className="text-xs text-red-600 hover:underline">delete</button>
        </div>
      ))}
      <form
        className="mt-2 flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          const optionValueIds = view.options.map((o) => sel[o.id]).filter(Boolean) as string[];
          if (optionValueIds.length !== view.options.length) { window.alert('Pick one value per option.'); return; }
          onRun(api.post(`/vendor/products/${productId}/variants`, { optionValueIds, sku: sku || undefined, quantity: Number(qty) || 0 }));
          setSel({}); setSku(''); setQty('0');
        }}
      >
        {view.options.map((o) => (
          <select key={o.id} className={input} value={sel[o.id] ?? ''} onChange={(e) => setSel({ ...sel, [o.id]: e.target.value })}>
            <option value="">{o.name}…</option>
            {o.values.map((v) => <option key={v.id} value={v.id}>{v.value}</option>)}
          </select>
        ))}
        <input className={`${input} w-24`} placeholder="SKU" value={sku} onChange={(e) => setSku(e.target.value)} />
        <input className={`${input} w-16`} placeholder="Qty" value={qty} onChange={(e) => setQty(e.target.value)} />
        <button className={btn}>Add variant</button>
      </form>
    </div>
  );
}

function InventoryPanel({ inv, hasVariants, onRun, productId, valueLabel, view }: { inv: Inventory; hasVariants: boolean; onRun: (p: Promise<unknown>) => void; productId: string; valueLabel: (id: string) => string; view: ManageView }) {
  return (
    <div>
      <h3 className="bmpl-label mb-2">Inventory</h3>
      {!hasVariants ? (
        <StockRow label="Product stock" row={inv.product} productId={productId} onRun={onRun} />
      ) : (
        inv.variants.map((r) => {
          const variant = view.variants.find((v) => v.id === r.variantId);
          const label = variant ? variant.optionValueIds.map(valueLabel).join(' / ') : (r.sku ?? 'variant');
          return <StockRow key={r.inventoryId} label={label} row={r} productId={productId} variantId={r.variantId!} onRun={onRun} />;
        })
      )}
    </div>
  );
}

const STOCK_TONE = (row: InvRow): Tone => (row.outOfStock ? 'error' : row.lowStock ? 'warning' : 'success');

function StockRow({ label, row, productId, variantId, onRun }: { label: string; row: InvRow; productId: string; variantId?: string; onRun: (p: Promise<unknown>) => void }) {
  const [delta, setDelta] = useState('');
  const q = variantId ? `?variantId=${variantId}` : '';
  return (
    <div className="mb-2 rounded-bmpl-md border border-slate-200 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium text-belize-navy">{label}</span>
        <Badge tone={row.unlimited ? 'brand' : STOCK_TONE(row)}>
          {row.unlimited ? 'Unlimited' : row.outOfStock ? 'Out of stock' : row.lowStock ? `Low (${row.available})` : `In stock (${row.available})`}
        </Badge>
        <span className="text-xs text-slate-400">on-hand {row.quantity} · reserved {row.reserved}</span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-3">
        <input className={`${input} w-20`} placeholder="+/- qty" value={delta} onChange={(e) => setDelta(e.target.value)} />
        <button
          className={btn}
          onClick={() => { const d = Number(delta); if (!d) return; onRun(api.post(`/vendor/products/${productId}/inventory/adjust${q}`, { delta: d, reason: d > 0 ? 'RESTOCK' : 'CORRECTION' })); setDelta(''); }}
        >
          Adjust
        </button>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={row.unlimited} onChange={(e) => onRun(api.patch(`/vendor/products/${productId}/inventory${q}`, { unlimited: e.target.checked }))} /> Unlimited</label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600"><input type="checkbox" className="h-3.5 w-3.5 rounded border-slate-300 text-belize-blue focus:ring-2 focus:ring-belize-accent/30" checked={row.allowBackorders} onChange={(e) => onRun(api.patch(`/vendor/products/${productId}/inventory${q}`, { allowBackorders: e.target.checked }))} /> Backorders</label>
        <label className="flex items-center gap-1.5 text-xs text-slate-600">Low&nbsp;≤ <input className="w-14 rounded-bmpl-sm border border-slate-200 px-1.5 py-0.5 outline-none focus:border-belize-accent focus:ring-2 focus:ring-belize-accent/30" defaultValue={row.lowStockThreshold} onBlur={(e) => Number(e.target.value) !== row.lowStockThreshold && onRun(api.patch(`/vendor/products/${productId}/inventory${q}`, { lowStockThreshold: Number(e.target.value) }))} /></label>
      </div>
    </div>
  );
}
