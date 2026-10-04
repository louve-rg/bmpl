'use client';

import { useEffect, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import type { SavedAddress } from '../../../lib/address';
import {
  EMPTY_ADDRESS_BOOK_FORM,
  PIN_NOTE,
  addressBookProblem,
  buildAddressBookPayload,
  formFromRow,
  type AddressBookForm,
} from '../../../lib/address-book';
import { DISTRICTS, DISTRICT_LABELS } from '@bmpl/shared';
import { Alert, Button, Card, EmptyState, Field, Input, PageHeader, Select, Spinner } from '../../../components/ui';

/**
 * Favorites > Addresses: the signed-in customer's saved addresses.
 *
 * Create, edit, set default and delete, over the existing /addresses API. The
 * form is the same one for add and edit. Validation is the shared schema, so a
 * save that the server would refuse is refused here first, with the same rule.
 */
export default function AddressesPage() {
  const [rows, setRows] = useState<SavedAddress[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  // null = closed; 'new' = adding; a row id = editing that row.
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [form, setForm] = useState<AddressBookForm>(EMPTY_ADDRESS_BOOK_FORM);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [rowError, setRowError] = useState<string | null>(null);

  async function load() {
    try {
      setRows(await api.get<SavedAddress[]>('/addresses'));
      setLoadError(null);
    } catch (e) {
      setLoadError((e as ApiError).message ?? 'We could not load your addresses just now.');
    }
  }

  useEffect(() => {
    void load();
  }, []);

  function startNew() {
    setEditing('new');
    setForm(EMPTY_ADDRESS_BOOK_FORM);
    setFormError(null);
    setRowError(null);
  }

  function startEdit(row: SavedAddress) {
    setEditing(row.id);
    setForm(formFromRow(row));
    setFormError(null);
    setRowError(null);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!editing) return;
    const row = rows?.find((r) => r.id === editing);
    const payload = buildAddressBookPayload(form, row);
    const problem = addressBookProblem(payload);
    if (problem) {
      setFormError(problem);
      return;
    }
    setBusy(true);
    setFormError(null);
    try {
      if (editing === 'new') {
        await api.post('/addresses', payload);
      } else {
        await api.patch(`/addresses/${editing}`, payload);
      }
      setEditing(null);
      await load();
    } catch (err) {
      setFormError((err as ApiError).message ?? 'We could not save this address. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(row: SavedAddress) {
    setRowError(null);
    try {
      await api.patch(`/addresses/${row.id}`, { isDefault: true });
      await load();
    } catch (err) {
      setRowError((err as ApiError).message ?? 'We could not change the default address.');
    }
  }

  async function remove(row: SavedAddress) {
    if (!window.confirm('Remove this address from your saved addresses? This cannot be undone.')) return;
    setRowError(null);
    try {
      await api.del(`/addresses/${row.id}`);
      if (editing === row.id) setEditing(null);
      await load();
    } catch (err) {
      setRowError((err as ApiError).message ?? 'We could not remove this address.');
    }
  }

  const set = (k: keyof AddressBookForm) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const editingRow = editing && editing !== 'new' ? rows?.find((r) => r.id === editing) : undefined;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <PageHeader
        eyebrow="Favorites"
        title="Addresses"
        description="Addresses you save here are offered at checkout. Changing one does not change an order or shipment you have already placed."
        actions={
          editing === null ? (
            <Button type="button" onClick={startNew} className="min-h-[44px]">
              Add an address
            </Button>
          ) : null
        }
      />

      {loadError && <Alert tone="error">{loadError}</Alert>}
      {rowError && <Alert tone="error">{rowError}</Alert>}

      {editing !== null && (
        <Card title={editing === 'new' ? 'New address' : 'Edit address'}>
          <form onSubmit={save} className="grid gap-4 sm:grid-cols-2" noValidate>
            <Field label="Name for this address" htmlFor="ab-label" hint="For example Home or Work.">
              <Input id="ab-label" value={form.label} onChange={set('label')} maxLength={60} />
            </Field>
            <Field label="Full name" htmlFor="ab-name">
              <Input id="ab-name" value={form.fullName} onChange={set('fullName')} maxLength={120} autoComplete="name" />
            </Field>
            <Field label="Phone" htmlFor="ab-phone">
              <Input id="ab-phone" value={form.phone} onChange={set('phone')} maxLength={40} autoComplete="tel" />
            </Field>
            <Field label="Email (optional)" htmlFor="ab-email">
              <Input id="ab-email" type="email" value={form.email} onChange={set('email')} maxLength={160} autoComplete="email" />
            </Field>
            <Field label="Company (optional)" htmlFor="ab-company">
              <Input id="ab-company" value={form.company} onChange={set('company')} maxLength={120} />
            </Field>
            <Field label="District" htmlFor="ab-district">
              <Select id="ab-district" value={form.district} onChange={set('district')}>
                {DISTRICTS.map((d) => (
                  <option key={d} value={d}>
                    {DISTRICT_LABELS[d]}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Street or landmark" htmlFor="ab-line1">
              <Input id="ab-line1" value={form.addressLine1} onChange={set('addressLine1')} maxLength={200} />
            </Field>
            <Field label="Second line (optional)" htmlFor="ab-line2">
              <Input id="ab-line2" value={form.addressLine2} onChange={set('addressLine2')} maxLength={200} />
            </Field>
            <Field label="Town or village" htmlFor="ab-city">
              <Input id="ab-city" value={form.city} onChange={set('city')} maxLength={120} />
            </Field>
            <Field label="Directions (optional)" htmlFor="ab-instructions">
              <Input id="ab-instructions" value={form.instructions} onChange={set('instructions')} maxLength={500} />
            </Field>

            {editingRow && (editingRow.latitude != null || editingRow.longitude != null) && (
              <p className="text-sm text-slate-600 sm:col-span-2">{PIN_NOTE}</p>
            )}

            {formError && (
              <div className="sm:col-span-2">
                <Alert tone="error">{formError}</Alert>
              </div>
            )}

            <div className="flex flex-wrap gap-3 sm:col-span-2">
              <Button type="submit" disabled={busy} className="min-h-[44px]">
                {busy ? 'Saving…' : 'Save address'}
              </Button>
              <Button type="button" variant="outline" onClick={() => setEditing(null)} disabled={busy} className="min-h-[44px]">
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      )}

      {rows === null && !loadError ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows && rows.length === 0 && editing === null ? (
        <EmptyState
          title="No saved addresses yet"
          description="Add an address you use often, and it will be offered at checkout."
          action={<Button onClick={startNew}>Add an address</Button>}
        />
      ) : (
        <ul className="space-y-3">
          {rows?.map((row) => (
            <li key={row.id}>
              <Card>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-semibold text-belize-navy">
                      {row.label}
                      {row.isDefault && <span className="ml-2 text-xs font-medium text-belize-accent">Default</span>}
                    </p>
                    <p className="text-sm text-slate-700">{row.fullName}</p>
                    <p className="text-sm text-slate-600">{row.phone}</p>
                    <p className="text-sm text-slate-600">
                      {row.addressLine1}
                      {row.addressLine2 ? `, ${row.addressLine2}` : ''}, {row.city}, {DISTRICT_LABELS[row.district as keyof typeof DISTRICT_LABELS] ?? row.district}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => startEdit(row)} disabled={editing !== null}>
                      Edit
                    </Button>
                    {!row.isDefault && (
                      <Button type="button" variant="outline" size="sm" className="min-h-[44px]" onClick={() => makeDefault(row)} disabled={editing !== null}>
                        Make default
                      </Button>
                    )}
                    <Button type="button" variant="ghost" size="sm" className="min-h-[44px]" onClick={() => remove(row)} disabled={editing !== null}>
                      Delete
                    </Button>
                  </div>
                </div>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
