'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, type ApiError } from '../../../lib/api';
import { Alert, Button, EmptyState, Input, Label, PageHeader, Select, Spinner } from '../../../components/ui';

interface AdminCategory {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  iconName: string | null;
  imageKey: string | null;
  featured: boolean;
  isVisible: boolean;
  sortOrder: number;
  parentId: string | null;
  childCount: number;
}

/** Flatten the category forest into display order with a depth for indentation. */
function ordered(cats: AdminCategory[]): Array<{ cat: AdminCategory; depth: number }> {
  const byParent = new Map<string | null, AdminCategory[]>();
  for (const c of cats) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }
  for (const list of byParent.values()) {
    list.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
  }
  const out: Array<{ cat: AdminCategory; depth: number }> = [];
  const walk = (parentId: string | null, depth: number) => {
    for (const c of byParent.get(parentId) ?? []) {
      out.push({ cat: c, depth });
      walk(c.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

function descendantIds(cats: AdminCategory[], id: string): Set<string> {
  const out = new Set<string>();
  const walk = (parentId: string) => {
    for (const c of cats) {
      if (c.parentId === parentId && !out.has(c.id)) {
        out.add(c.id);
        walk(c.id);
      }
    }
  };
  walk(id);
  return out;
}

export default function CategoriesPage() {
  const [cats, setCats] = useState<AdminCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // create form
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const [sortOrder, setSortOrder] = useState('0');
  const [featured, setFeatured] = useState(false);
  const [busy, setBusy] = useState(false);

  // inline edit
  const [editId, setEditId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ name: string; slug: string; parentId: string; sortOrder: string }>({
    name: '',
    slug: '',
    parentId: '',
    sortOrder: '0',
  });

  const rows = useMemo(() => ordered(cats), [cats]);

  async function load() {
    setLoading(true);
    try {
      setCats(await api.get<AdminCategory[]>('/admin/categories'));
      setError(null);
    } catch (e) {
      setError((e as ApiError).status === 403 ? 'You need the “categories.manage” permission.' : 'Failed to load categories.');
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => {
    void load();
  }, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/admin/categories', {
        name: name.trim(),
        parentId: parentId || null,
        sortOrder: Number(sortOrder) || 0,
        featured,
      });
      setName('');
      setParentId('');
      setSortOrder('0');
      setFeatured(false);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Create failed.');
    } finally {
      setBusy(false);
    }
  }

  async function patch(id: string, body: Record<string, unknown>) {
    try {
      await api.patch(`/admin/categories/${id}`, body);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Update failed.');
    }
  }

  async function saveEdit(id: string) {
    await patch(id, {
      name: edit.name.trim(),
      slug: edit.slug.trim(),
      parentId: edit.parentId || null,
      sortOrder: Number(edit.sortOrder) || 0,
    });
    setEditId(null);
  }

  async function remove(cat: AdminCategory) {
    if (cat.childCount > 0) {
      window.alert('Move or delete the subcategories first.');
      return;
    }
    if (!window.confirm(`Delete “${cat.name}”? This cannot be undone.`)) return;
    try {
      await api.del(`/admin/categories/${cat.id}`);
      await load();
    } catch (e) {
      window.alert((e as ApiError).message ?? 'Delete failed.');
    }
  }

  return (
    <div>
      <PageHeader eyebrow="Marketplace" title="Categories" />

      {error && (
        <Alert tone="warning" className="mb-5">
          {error}
        </Alert>
      )}

      {/* Create */}
      <form onSubmit={create} className="mb-6 flex flex-wrap items-end gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-4 shadow-bmpl-sm">
        <div className="flex flex-col gap-1">
          <Label htmlFor="cat-name">Name</Label>
          <Input
            id="cat-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Electronics"
            className="w-56"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cat-parent">Parent</Label>
          <Select
            id="cat-parent"
            value={parentId}
            onChange={(e) => setParentId(e.target.value)}
            className="w-56"
          >
            <option value="">— none (root) —</option>
            {rows.map(({ cat, depth }) => (
              <option key={cat.id} value={cat.id}>
                {' '.repeat(depth * 2)}
                {cat.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="cat-sort">Sort</Label>
          <Input
            id="cat-sort"
            type="number"
            value={sortOrder}
            onChange={(e) => setSortOrder(e.target.value)}
            className="w-20"
          />
        </div>
        <label className="flex items-center gap-2 pb-2.5 text-sm text-slate-700">
          <input type="checkbox" checked={featured} onChange={(e) => setFeatured(e.target.checked)} />
          Featured
        </label>
        <Button type="submit" disabled={busy || !name.trim()}>
          Add category
        </Button>
      </form>

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : rows.length === 0 ? (
        <EmptyState title="No categories yet" description="Add your first category using the form above." />
      ) : (
        <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-3">Name</th>
                <th className="px-4 py-3">Slug</th>
                <th className="px-4 py-3">Visible</th>
                <th className="px-4 py-3">Featured</th>
                <th className="px-4 py-3">Sort</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ cat, depth }) =>
                editId === cat.id ? (
                  <tr key={cat.id} className="border-t border-slate-100 bg-slate-50">
                    <td className="px-4 py-3" colSpan={6}>
                      <div className="flex flex-wrap items-end gap-3">
                        <Input
                          value={edit.name}
                          onChange={(e) => setEdit({ ...edit, name: e.target.value })}
                          placeholder="Name"
                          className="w-48"
                        />
                        <Input
                          value={edit.slug}
                          onChange={(e) => setEdit({ ...edit, slug: e.target.value })}
                          placeholder="slug"
                          className="w-48"
                        />
                        <Select
                          value={edit.parentId}
                          onChange={(e) => setEdit({ ...edit, parentId: e.target.value })}
                          className="w-48"
                        >
                          <option value="">— none (root) —</option>
                          {rows
                            .filter(
                              ({ cat: c }) =>
                                c.id !== cat.id && !descendantIds(cats, cat.id).has(c.id),
                            )
                            .map(({ cat: c, depth: d }) => (
                              <option key={c.id} value={c.id}>
                                {' '.repeat(d * 2)}
                                {c.name}
                              </option>
                            ))}
                        </Select>
                        <Input
                          type="number"
                          value={edit.sortOrder}
                          onChange={(e) => setEdit({ ...edit, sortOrder: e.target.value })}
                          className="w-20"
                        />
                        <Button size="sm" onClick={() => void saveEdit(cat.id)}>
                          Save
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => setEditId(null)}>
                          Cancel
                        </Button>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={cat.id} className="border-t border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <span style={{ paddingLeft: `${depth * 18}px` }} className="font-medium text-belize-navy">
                        {depth > 0 && <span className="text-slate-300">└ </span>}
                        {cat.name}
                      </span>
                      {cat.childCount > 0 && (
                        <span className="ml-2 text-xs text-slate-400">({cat.childCount})</span>
                      )}
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{cat.slug}</td>
                    <td className="px-4 py-3">
                      <Toggle on={cat.isVisible} onClick={() => void patch(cat.id, { isVisible: !cat.isVisible })} labelOn="Visible" labelOff="Hidden" />
                    </td>
                    <td className="px-4 py-3">
                      <Toggle on={cat.featured} onClick={() => void patch(cat.id, { featured: !cat.featured })} labelOn="Featured" labelOff="—" />
                    </td>
                    <td className="px-4 py-3 text-slate-600">{cat.sortOrder}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => {
                            setEditId(cat.id);
                            setEdit({
                              name: cat.name,
                              slug: cat.slug,
                              parentId: cat.parentId ?? '',
                              sortOrder: String(cat.sortOrder),
                            });
                          }}
                        >
                          Edit
                        </Button>
                        <Button size="sm" variant="destructive" onClick={() => void remove(cat)}>
                          Delete
                        </Button>
                      </div>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Toggle({
  on,
  onClick,
  labelOn,
  labelOff,
}: {
  on: boolean;
  onClick: () => void;
  labelOn: string;
  labelOff: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold transition ${
        on ? 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'
      }`}
    >
      {on ? labelOn : labelOff}
    </button>
  );
}
