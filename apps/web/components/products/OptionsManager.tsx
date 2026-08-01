'use client';

import { useState } from 'react';
import { api } from '../../lib/api';
import type { ManageView, OptionValue, ProductOption } from './types';
import { asApiError, smallInput, tinyInput } from './shared';

interface Props {
  view: ManageView;
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}

export function OptionsManager({ view, productId, reload, onError }: Props) {
  const locked = view.variants.length > 0;

  return (
    <section>
      <div className="mb-1 flex items-center justify-between gap-2">
        <h3 className="bmpl-label mb-0">Options</h3>
      </div>
      <p className="mb-3 text-xs text-slate-400">
        Manage the values buyers choose from. Adding a value here makes it available in the variant builder below.
      </p>

      <div className="space-y-3">
        {view.options.map((o) => (
          <OptionRow key={o.id} option={o} productId={productId} locked={locked} reload={reload} onError={onError} />
        ))}
      </div>

      {view.options.length === 0 && !locked && (
        <p className="mb-3 mt-1 text-sm text-slate-500">No options yet. Add one (e.g. Color, Size) to create variants.</p>
      )}

      {locked ? (
        <p className="mt-3 text-xs text-slate-400">
          Options are fixed once variants exist — edit values instead. Delete all variants to change the option set.
        </p>
      ) : (
        <AddOptionForm productId={productId} reload={reload} onError={onError} />
      )}
    </section>
  );
}

function OptionRow({
  option,
  productId,
  locked,
  reload,
  onError,
}: {
  option: ProductOption;
  productId: string;
  locked: boolean;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  return (
    <div className="rounded-bmpl-md border border-slate-200 p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <span className="text-sm font-semibold text-belize-navy">{option.name}</span>
        {!locked && (
          <button
            type="button"
            onClick={async () => {
              setDeleteErr(null);
              try {
                await api.del(`/vendor/products/${productId}/options/${option.id}`);
                await reload();
              } catch (e) {
                setDeleteErr(asApiError(e).message);
              }
            }}
            className="text-xs font-semibold text-red-600 hover:underline"
          >
            Remove option
          </button>
        )}
      </div>
      {deleteErr && <p className="mb-2 text-xs font-medium text-red-600">{deleteErr}</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        {option.values.map((v) => (
          <ValueChip key={v.id} value={v} productId={productId} reload={reload} onError={onError} />
        ))}
        <AddValueInput optionId={option.id} productId={productId} reload={reload} onError={onError} />
      </div>
    </div>
  );
}

function ValueChip({
  value,
  productId,
  reload,
  onError,
}: {
  value: OptionValue;
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [mode, setMode] = useState<'idle' | 'edit' | 'confirm' | 'force'>('idle');
  const [draft, setDraft] = useState(value.value);
  const [forceMsg, setForceMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function rename() {
    const next = draft.trim();
    if (!next || next === value.value) {
      setMode('idle');
      setDraft(value.value);
      return;
    }
    setBusy(true);
    try {
      await api.patch(`/vendor/products/${productId}/option-values/${value.id}`, { value: next });
      await reload();
      setMode('idle');
    } catch (e) {
      onError(asApiError(e).message);
      setDraft(value.value);
      setMode('idle');
    } finally {
      setBusy(false);
    }
  }

  async function remove(force: boolean) {
    setBusy(true);
    try {
      await api.del(`/vendor/products/${productId}/option-values/${value.id}${force ? '?force=true' : ''}`);
      await reload();
      setMode('idle');
      setForceMsg(null);
    } catch (e) {
      const err = asApiError(e);
      if (err.status === 409 && !force) {
        setForceMsg(err.message);
        setMode('force');
      } else {
        onError(err.message);
        setMode('idle');
      }
    } finally {
      setBusy(false);
    }
  }

  if (mode === 'edit') {
    return (
      <span className="inline-flex items-center gap-1">
        <input
          autoFocus
          className={`${tinyInput} w-24`}
          value={draft}
          disabled={busy}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void rename();
            if (e.key === 'Escape') {
              setDraft(value.value);
              setMode('idle');
            }
          }}
        />
        <button type="button" disabled={busy} onClick={() => void rename()} className="text-xs font-semibold text-belize-blue hover:underline">
          Save
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setDraft(value.value);
            setMode('idle');
          }}
          className="text-xs text-slate-500 hover:underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  if (mode === 'confirm' || mode === 'force') {
    return (
      <span className="inline-flex flex-wrap items-center gap-1.5 rounded-bmpl-sm border border-amber-200 bg-amber-50 px-2 py-1">
        <span className="text-xs text-belize-navy">
          {mode === 'force' ? forceMsg : `Remove “${value.value}”?`}
        </span>
        <button
          type="button"
          disabled={busy}
          onClick={() => void remove(mode === 'force')}
          className="rounded-bmpl-sm bg-red-600 px-2 py-0.5 text-xs font-semibold text-white hover:bg-red-700 disabled:opacity-50"
        >
          {busy ? '…' : mode === 'force' ? 'Remove anyway' : 'Remove'}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setMode('idle');
            setForceMsg(null);
          }}
          className="text-xs font-semibold text-slate-500 hover:underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-slate-100 py-0.5 pl-2.5 pr-1 text-xs font-semibold text-slate-600">
      {value.value}
      <button
        type="button"
        onClick={() => {
          setDraft(value.value);
          setMode('edit');
        }}
        aria-label={`Rename ${value.value}`}
        className="rounded px-1 text-slate-400 hover:text-belize-blue"
      >
        Edit
      </button>
      <button
        type="button"
        onClick={() => setMode('confirm')}
        aria-label={`Remove ${value.value}`}
        className="rounded px-1 text-slate-400 hover:text-red-600"
      >
        ×
      </button>
    </span>
  );
}

function AddValueInput({
  optionId,
  productId,
  reload,
  onError,
}: {
  optionId: string;
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="inline-flex items-center gap-1"
      onSubmit={async (e) => {
        e.preventDefault();
        const v = value.trim();
        if (!v) return;
        setBusy(true);
        try {
          await api.post(`/vendor/products/${productId}/options/${optionId}/values`, { value: v });
          setValue('');
          await reload();
        } catch (err) {
          onError(asApiError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input
        className={`${tinyInput} w-28`}
        placeholder="+ Add value"
        value={value}
        disabled={busy}
        onChange={(e) => setValue(e.target.value)}
        aria-label="Add option value"
      />
      {value.trim() && (
        <button type="submit" disabled={busy} className="text-xs font-semibold text-belize-blue hover:underline">
          Add
        </button>
      )}
    </form>
  );
}

function AddOptionForm({
  productId,
  reload,
  onError,
}: {
  productId: string;
  reload: () => Promise<void>;
  onError: (msg: string) => void;
}) {
  const [name, setName] = useState('');
  const [values, setValues] = useState('');
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="mt-3 flex flex-wrap items-center gap-2 rounded-bmpl-md border border-dashed border-slate-300 p-3"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!name.trim()) return;
        setBusy(true);
        try {
          await api.post(`/vendor/products/${productId}/options`, {
            name: name.trim(),
            values: values.split(',').map((s) => s.trim()).filter(Boolean),
          });
          setName('');
          setValues('');
          await reload();
        } catch (err) {
          onError(asApiError(err).message);
        } finally {
          setBusy(false);
        }
      }}
    >
      <input className={`${smallInput} w-40`} placeholder="Option (e.g. Color)" value={name} disabled={busy} onChange={(e) => setName(e.target.value)} aria-label="New option name" />
      <input className={`${smallInput} min-w-0 flex-1`} placeholder="Values: Red, Blue, Green" value={values} disabled={busy} onChange={(e) => setValues(e.target.value)} aria-label="New option values" />
      <button
        type="submit"
        disabled={busy || !name.trim()}
        className="rounded-bmpl-md bg-belize-blue px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-belize-deep disabled:opacity-50"
      >
        + Add option
      </button>
    </form>
  );
}
