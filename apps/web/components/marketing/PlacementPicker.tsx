'use client';

import {
  PROMOTION_PLACEMENTS,
  PROMOTION_PLACEMENT_LABELS,
  CATEGORY_CONTEXT_PLACEMENTS,
  type PromotionPlacementType,
} from '@bmpl/shared';
import type { PlacementInput } from '../../lib/marketing';
import { Input } from '../ui';

/**
 * Multi-select of where a promotion appears. Toggling a placement adds/removes it;
 * category-context placements (Category page) reveal an optional category-id field.
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
  const selected = new Map(value.map((p) => [p.placement, p]));

  function toggle(placement: PromotionPlacementType) {
    const next = new Map(selected);
    if (next.has(placement)) next.delete(placement);
    else next.set(placement, { placement, position: 0, categoryId: null });
    onChange(Array.from(next.values()));
  }

  function setCategory(placement: PromotionPlacementType, categoryId: string) {
    const next = value.map((p) =>
      p.placement === placement ? { ...p, categoryId: categoryId.trim() || null } : p,
    );
    onChange(next);
  }

  return (
    <div className="space-y-2">
      {PROMOTION_PLACEMENTS.map((placement) => {
        const current = selected.get(placement);
        const isCategory = CATEGORY_CONTEXT_PLACEMENTS.includes(placement);
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
                <Input
                  placeholder="Category ID (optional)"
                  value={current.categoryId ?? ''}
                  disabled={disabled}
                  onChange={(e) => setCategory(placement, e.target.value)}
                  className="text-xs"
                />
                <p className="mt-1 text-xs text-slate-400">
                  Scope this placement to a single category by its ID.
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
