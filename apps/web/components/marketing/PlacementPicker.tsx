'use client';

import { useEffect, useState } from 'react';
import {
  PROMOTION_PLACEMENTS,
  PROMOTION_PLACEMENT_LABELS,
  CATEGORY_CONTEXT_PLACEMENTS,
  type PromotionPlacementType,
} from '@bmpl/shared';
import type { PlacementInput } from '../../lib/marketing';
import { api } from '../../lib/api';
import { Select } from '../ui';

interface CategoryNode {
  id: string;
  name: string;
  children: CategoryNode[];
}

/** Same flattening shape as ProductForm's own category select — indented by depth
 *  so a subcategory reads as nested under its parent, not as a sibling. */
function flatten(nodes: CategoryNode[], depth = 0): Array<{ id: string; label: string }> {
  return nodes.flatMap((n) => [
    { id: n.id, label: `${'— '.repeat(depth)}${n.name}` },
    ...flatten(n.children ?? [], depth + 1),
  ]);
}

/**
 * Multi-select of where a promotion appears. Toggling a placement adds/removes it;
 * category-context placements (Category page) reveal an optional category select —
 * by name, from the same public `/marketplace/categories` tree ProductForm's own
 * category field already uses. No internal id is ever typed by hand.
 * Controlled: emits the full PlacementInput[] on every change.
 */
export function PlacementPicker({
  value,
  onChange,
  disabled,
}: {
  value: PlacementInput[];
  onChange: (next: PlacementInput[]) => void;
  disabled?: boolean;
}) {
  const [cats, setCats] = useState<Array<{ id: string; label: string }> | null>(null);

  useEffect(() => {
    void api
      .get<CategoryNode[]>('/marketplace/categories')
      .then((tree) => setCats(flatten(tree)))
      .catch(() => setCats([]));
  }, []);

  const selected = new Map(value.map((p) => [p.placement, p]));

  function toggle(placement: PromotionPlacementType) {
    const next = new Map(selected);
    if (next.has(placement)) next.delete(placement);
    else next.set(placement, { placement, position: 0, categoryId: null });
    onChange(Array.from(next.values()));
  }

  function setCategory(placement: PromotionPlacementType, categoryId: string) {
    const next = value.map((p) =>
      p.placement === placement ? { ...p, categoryId: categoryId || null } : p,
    );
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {PROMOTION_PLACEMENTS.map((placement) => {
        const current = selected.get(placement);
        const isCategory = CATEGORY_CONTEXT_PLACEMENTS.includes(placement);
        // A promotion saved earlier may carry a category id that is no longer in
        // the public (visible) list — hidden since, or deleted. Keep it selectable
        // rather than silently clearing it: dropping the option out from under an
        // existing promotion would quietly unscope it the next time this form saves.
        const currentId = current?.categoryId ?? '';
        const knownIds = new Set((cats ?? []).map((c) => c.id));
        const options = cats ?? [];
        const loading = cats === null;
        const currentMissing = currentId !== '' && !loading && !knownIds.has(currentId);

        return (
          <div key={placement} className="rounded-bmpl-md border border-slate-200 p-3">
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                checked={!!current}
                disabled={disabled}
                onChange={() => toggle(placement)}
                className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
              />
              <span className="font-medium">{PROMOTION_PLACEMENT_LABELS[placement]}</span>
            </label>
            {current && isCategory && (
              <div className="mt-2 pl-6">
                <Select
                  aria-label="Category (optional)"
                  value={currentId}
                  disabled={disabled || loading}
                  onChange={(e) => setCategory(placement, e.target.value)}
                  className="text-xs"
                >
                  <option value="">No category (optional)</option>
                  {currentMissing && (
                    <option value={currentId} disabled>
                      Current category (no longer listed)
                    </option>
                  )}
                  {options.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.label}
                    </option>
                  ))}
                </Select>
                <p className="mt-1 text-xs text-[color:var(--bmpl-text-muted-strong)]">
                  {loading
                    ? 'Loading categories…'
                    : options.length === 0
                      ? 'No categories are available to scope this placement to right now.'
                      : currentMissing
                        ? "This promotion's category is no longer listed (hidden or removed) — pick a current one, or leave it as-is."
                        : 'Scope this placement to a single category.'}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
