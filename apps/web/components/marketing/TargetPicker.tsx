'use client';

import {
  PROMOTION_TARGET_TYPES,
  PROMOTION_TARGET_TYPE_LABELS,
  MAX_PROMOTION_TARGETS,
  type PromotionTargetType,
} from '@bmpl/shared';
import type { TargetInput } from '../../lib/marketing';
import { Button, Input, Select } from '../ui';

/** Which single input field carries the value for a given target type (null = no field). */
const FK_FIELD: Record<PromotionTargetType, keyof TargetInput | null> = {
  VENDOR: 'vendorProfileId',
  EMPLOYER: 'employerProfileId',
  AGENCY: 'agencyProfileId',
  AGENT: 'agentProfileId',
  PROPERTY_OWNER: 'propertyOwnerProfileId',
  PRODUCT: 'productId',
  JOB: 'jobListingId',
  PROPERTY: 'propertyListingId',
  EXTERNAL_LINK: 'externalUrl',
  NONE: null,
};

const FIELD_HINT: Record<PromotionTargetType, string> = {
  VENDOR: 'Your vendor profile ID',
  EMPLOYER: 'Your employer profile ID',
  AGENCY: 'Your agency profile ID',
  AGENT: 'Your agent profile ID',
  PROPERTY_OWNER: 'Your property-owner profile ID',
  PRODUCT: 'A product ID you own',
  JOB: 'A job listing ID you own',
  PROPERTY: 'A property listing ID you own',
  EXTERNAL_LINK: 'https://…',
  NONE: '',
};

/**
 * A simple typed target picker. Each row is a target type plus the single ID (or URL)
 * it needs — ownership is enforced server-side (403/404 surfaced by the caller). Emits
 * the full TargetInput[] on change.
 */
export function TargetPicker({
  value,
  onChange,
  disabled,
}: {
  value: TargetInput[];
  onChange: (next: TargetInput[]) => void;
  disabled?: boolean;
}) {
  function add() {
    if (value.length >= MAX_PROMOTION_TARGETS) return;
    onChange([...value, { targetType: 'VENDOR' }]);
  }

  function remove(index: number) {
    onChange(value.filter((_, i) => i !== index));
  }

  function setType(index: number, targetType: PromotionTargetType) {
    onChange(value.map((t, i) => (i === index ? { targetType } : t)));
  }

  function setValue(index: number, raw: string) {
    onChange(
      value.map((t, i) => {
        if (i !== index) return t;
        const field = FK_FIELD[t.targetType];
        if (!field) return { targetType: t.targetType };
        return { targetType: t.targetType, [field]: raw.trim() || undefined };
      }),
    );
  }

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-slate-400">
          No targets yet. Add at least one before submitting for review.
        </p>
      )}
      {value.map((t, i) => {
        const field = FK_FIELD[t.targetType];
        const fieldValue = field ? ((t[field] as string | undefined) ?? '') : '';
        return (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-bmpl-md border border-slate-200 p-3">
            <div className="min-w-[10rem] flex-1">
              <Select
                value={t.targetType}
                disabled={disabled}
                onChange={(e) => setType(i, e.target.value as PromotionTargetType)}
              >
                {PROMOTION_TARGET_TYPES.map((tt) => (
                  <option key={tt} value={tt}>
                    {PROMOTION_TARGET_TYPE_LABELS[tt]}
                  </option>
                ))}
              </Select>
            </div>
            {field && (
              <div className="min-w-[12rem] flex-[2]">
                <Input
                  placeholder={FIELD_HINT[t.targetType]}
                  value={fieldValue}
                  disabled={disabled}
                  onChange={(e) => setValue(i, e.target.value)}
                />
              </div>
            )}
            <Button type="button" size="sm" variant="ghost" disabled={disabled} onClick={() => remove(i)}>
              Remove
            </Button>
          </div>
        );
      })}
      <Button
        type="button"
        size="sm"
        variant="outline"
        disabled={disabled || value.length >= MAX_PROMOTION_TARGETS}
        onClick={add}
      >
        + Add target
      </Button>
      <p className="text-xs text-slate-400">Up to {MAX_PROMOTION_TARGETS} targets. Ownership is verified server-side.</p>
    </div>
  );
}
