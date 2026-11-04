'use client';

import { useEffect, useState } from 'react';
import {
  PROMOTION_TARGET_TYPES,
  PROMOTION_TARGET_TYPE_LABELS,
  MAX_PROMOTION_TARGETS,
  type PromotionTargetType,
} from '@bmpl/shared';
import type { TargetInput } from '../../lib/marketing';
import { api } from '../../lib/api';
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

/**
 * Real Estate (AGENCY/AGENT/PROPERTY_OWNER/PROPERTY) is explicitly out of
 * scope for this pass — not touched, same raw-id field as before. The four
 * remaining typed targets (VENDOR, EMPLOYER, PRODUCT, JOB) are resolved
 * below from the caller's OWN existing data, reusing endpoints each
 * respective dashboard already has: nothing new added.
 */
const REAL_ESTATE: readonly PromotionTargetType[] = ['AGENCY', 'AGENT', 'PROPERTY_OWNER', 'PROPERTY'];

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

interface OwnOption { id: string; label: string }

/** VENDOR and EMPLOYER target exactly one thing — the caller's own single
 *  profile, enforced server-side (`verifyTargetOwnership`) — so there is
 *  nothing to search; this resolves to it once and reports whether one
 *  exists at all. `null` = none yet (that target type is unusable here). */
function useOwnSingle(path: string, nameOf: (p: Record<string, unknown>) => string) {
  const [state, setState] = useState<{ id: string; name: string } | null | undefined>(undefined);
  useEffect(() => {
    void api
      .get<{ id?: string; profile?: { id: string } | null } & Record<string, unknown>>(path)
      .then((p) => {
        const row = (p?.profile ?? p) as (Record<string, unknown> & { id?: string }) | null;
        setState(row?.id ? { id: row.id, name: nameOf(row) } : null);
      })
      .catch(() => setState(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return state;
}

/** PRODUCT/JOB may have many of the caller's own rows — fetched once and
 *  offered as a name-based Select, same shape as ProductForm's own category
 *  field uses against a different list. */
function useOwnList(path: string): OwnOption[] | null {
  const [list, setList] = useState<OwnOption[] | null>(null);
  useEffect(() => {
    void api
      .get<Array<{ id: string; title: string }>>(path)
      .then((rows) => setList(rows.map((r) => ({ id: r.id, label: r.title }))))
      .catch(() => setList([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path]);
  return list;
}

/**
 * A typed target picker. Each row is a target type plus the single value it
 * needs. For VENDOR/EMPLOYER/PRODUCT/JOB the value is chosen by name from the
 * caller's own data — never typed as a raw id. Real Estate target types are
 * unchanged (out of scope here). Ownership is still re-verified server-side
 * regardless of how the id reached this form. Emits the full TargetInput[]
 * on change.
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
  const ownVendor = useOwnSingle('/vendor/profile', (p) => (p.businessName as string) ?? 'Your store');
  const ownEmployer = useOwnSingle('/employer/profile', (p) => (p.companyName as string) ?? 'Your company');
  const ownProducts = useOwnList('/vendor/products');
  const ownJobs = useOwnList('/employer/jobs');

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

  /** Auto-fill a single-choice (VENDOR/EMPLOYER) row the instant its one
   *  valid value resolves, so a freshly-added row never sits on an empty id
   *  waiting for someone to type one in. A no-op once already set. */
  useEffect(() => {
    value.forEach((t, i) => {
      if (t.targetType === 'VENDOR' && ownVendor && !t.vendorProfileId) setValue(i, ownVendor.id);
      if (t.targetType === 'EMPLOYER' && ownEmployer && !t.employerProfileId) setValue(i, ownEmployer.id);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, ownVendor, ownEmployer]);

  return (
    <div className="space-y-3">
      {value.length === 0 && (
        <p className="text-sm text-[color:var(--bmpl-text-muted-strong)]">
          No targets yet. Add at least one before submitting for review.
        </p>
      )}
      {value.map((t, i) => {
        const field = FK_FIELD[t.targetType];
        const fieldValue = field ? ((t[field] as string | undefined) ?? '') : '';
        const isRealEstate = REAL_ESTATE.includes(t.targetType);

        return (
          <div key={i} className="flex flex-wrap items-end gap-2 rounded-bmpl-md border border-slate-200 p-3">
            <div className="min-w-[10rem] flex-1">
              <Select
                aria-label="Target type"
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

            {t.targetType === 'VENDOR' && (
              <div className="min-w-[12rem] flex-[2] text-sm">
                {ownVendor === undefined ? (
                  <span className="text-[color:var(--bmpl-text-muted-strong)]">Loading your store…</span>
                ) : ownVendor ? (
                  <span>Targeting your own store: <strong>{ownVendor.name}</strong></span>
                ) : (
                  <span className="text-red-700">You do not have a vendor profile to target.</span>
                )}
              </div>
            )}
            {t.targetType === 'EMPLOYER' && (
              <div className="min-w-[12rem] flex-[2] text-sm">
                {ownEmployer === undefined ? (
                  <span className="text-[color:var(--bmpl-text-muted-strong)]">Loading your company…</span>
                ) : ownEmployer ? (
                  <span>Targeting your own company: <strong>{ownEmployer.name}</strong></span>
                ) : (
                  <span className="text-red-700">You do not have an employer profile to target.</span>
                )}
              </div>
            )}
            {(t.targetType === 'PRODUCT' || t.targetType === 'JOB') && (() => {
              const list = t.targetType === 'PRODUCT' ? ownProducts : ownJobs;
              const loading = list === null;
              const options = list ?? [];
              const currentMissing = fieldValue !== '' && !loading && !options.some((o) => o.id === fieldValue);
              return (
                <div className="min-w-[12rem] flex-[2]">
                  <Select
                    aria-label={t.targetType === 'PRODUCT' ? 'Your product' : 'Your job listing'}
                    value={fieldValue}
                    disabled={disabled || loading}
                    onChange={(e) => setValue(i, e.target.value)}
                  >
                    <option value="">{loading ? 'Loading…' : `Select a ${t.targetType === 'PRODUCT' ? 'product' : 'job listing'}…`}</option>
                    {currentMissing && (
                      <option value={fieldValue} disabled>
                        Current selection (no longer available)
                      </option>
                    )}
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>{o.label}</option>
                    ))}
                  </Select>
                  {!loading && options.length === 0 && !currentMissing && (
                    <p className="mt-1 text-xs text-red-700">
                      {t.targetType === 'PRODUCT' ? 'You have no products to target yet.' : 'You have no job listings to target yet.'}
                    </p>
                  )}
                </div>
              );
            })()}
            {t.targetType === 'EXTERNAL_LINK' && (
              <div className="min-w-[12rem] flex-[2]">
                <Input
                  aria-label="Target value"
                  placeholder={FIELD_HINT.EXTERNAL_LINK}
                  value={fieldValue}
                  disabled={disabled}
                  onChange={(e) => setValue(i, e.target.value)}
                />
              </div>
            )}
            {isRealEstate && (
              <div className="min-w-[12rem] flex-[2]">
                <Input
                  aria-label="Target value"
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
      <p className="text-xs text-[color:var(--bmpl-text-muted-strong)]">Up to {MAX_PROMOTION_TARGETS} targets. Ownership is verified server-side.</p>
    </div>
  );
}
