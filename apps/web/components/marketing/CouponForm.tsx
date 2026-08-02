'use client';

import { useState } from 'react';
import { COUPON_DISCOUNT_TYPES, COUPON_DISCOUNT_TYPE_LABELS, type CouponDiscountType } from '@bmpl/shared';
import { toLocalInput, type Coupon } from '../../lib/marketing';
import { Button, Field, Input, Select } from '../ui';

/** All coupon fields this form edits. The parent maps to CreateCouponInput (create) or
 *  UpdateCouponInput (edit, which ignores code + discountType). Money is in MINOR units. */
export interface CouponFormValues {
  code: string;
  discountType: CouponDiscountType;
  percentOff: number | null;
  amountOffMinor: number | null;
  freeShipping: boolean;
  minSpendMinor: number | null;
  maxDiscountMinor: number | null;
  maxUses: number | null;
  perUserLimit: number | null;
  stackable: boolean;
  startAt: string | null;
  endAt: string | null;
}

const dollarsToMinor = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.round(n * 100) : null;
};
const minorToDollars = (v: number | null | undefined): string => (v == null ? '' : String(v / 100));
const intOrNull = (v: string): number | null => {
  const t = v.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Create/edit a vendor coupon. */
export function CouponForm({
  initial,
  submitting,
  submitLabel = 'Save',
  onSubmit,
  footer,
}: {
  initial?: Coupon;
  submitting?: boolean;
  submitLabel?: string;
  onSubmit: (values: CouponFormValues) => void;
  footer?: React.ReactNode;
}) {
  const isEdit = !!initial;
  const [code, setCode] = useState(initial?.code ?? '');
  const [discountType, setDiscountType] = useState<CouponDiscountType>(initial?.discountType ?? 'PERCENTAGE');
  const [percentOff, setPercentOff] = useState(initial?.percentOff != null ? String(initial.percentOff) : '');
  const [amountOff, setAmountOff] = useState(minorToDollars(initial?.amountOffMinor));
  const [freeShipping, setFreeShipping] = useState(initial?.freeShipping ?? false);
  const [minSpend, setMinSpend] = useState(minorToDollars(initial?.minSpendMinor));
  const [maxDiscount, setMaxDiscount] = useState(minorToDollars(initial?.maxDiscountMinor));
  const [maxUses, setMaxUses] = useState(initial?.maxUses != null ? String(initial.maxUses) : '');
  const [perUserLimit, setPerUserLimit] = useState(initial?.perUserLimit != null ? String(initial.perUserLimit) : '');
  const [stackable, setStackable] = useState(initial?.stackable ?? false);
  const [startAt, setStartAt] = useState(toLocalInput(initial?.startAt));
  const [endAt, setEndAt] = useState(toLocalInput(initial?.endAt));

  function submit(e: React.FormEvent) {
    e.preventDefault();
    onSubmit({
      code: code.trim().toUpperCase(),
      discountType,
      percentOff: discountType === 'PERCENTAGE' ? intOrNull(percentOff) : null,
      amountOffMinor: discountType === 'FIXED_AMOUNT' ? dollarsToMinor(amountOff) : null,
      freeShipping,
      minSpendMinor: dollarsToMinor(minSpend),
      maxDiscountMinor: dollarsToMinor(maxDiscount),
      maxUses: intOrNull(maxUses),
      perUserLimit: intOrNull(perUserLimit),
      stackable,
      startAt: startAt ? new Date(startAt).toISOString() : null,
      endAt: endAt ? new Date(endAt).toISOString() : null,
    });
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Code" hint="3–32 chars: A–Z, 0–9, dashes.">
          <Input
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            disabled={isEdit}
            readOnly={isEdit}
            required
            maxLength={32}
            placeholder="SUMMER25"
          />
        </Field>
        <Field label="Discount type">
          <Select
            value={discountType}
            disabled={isEdit}
            onChange={(e) => setDiscountType(e.target.value as CouponDiscountType)}
          >
            {COUPON_DISCOUNT_TYPES.map((t) => (
              <option key={t} value={t}>
                {COUPON_DISCOUNT_TYPE_LABELS[t]}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      {discountType === 'PERCENTAGE' ? (
        <Field label="Percent off" hint="1–100.">
          <Input type="number" min={1} max={100} value={percentOff} onChange={(e) => setPercentOff(e.target.value)} />
        </Field>
      ) : (
        <Field label="Amount off (BZ$)">
          <Input type="number" min={0} step="0.01" value={amountOff} onChange={(e) => setAmountOff(e.target.value)} />
        </Field>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Minimum spend (BZ$, optional)">
          <Input type="number" min={0} step="0.01" value={minSpend} onChange={(e) => setMinSpend(e.target.value)} />
        </Field>
        <Field label="Max discount cap (BZ$, optional)">
          <Input type="number" min={0} step="0.01" value={maxDiscount} onChange={(e) => setMaxDiscount(e.target.value)} />
        </Field>
        <Field label="Max total uses (optional)">
          <Input type="number" min={1} value={maxUses} onChange={(e) => setMaxUses(e.target.value)} />
        </Field>
        <Field label="Per-user limit (optional)">
          <Input type="number" min={1} value={perUserLimit} onChange={(e) => setPerUserLimit(e.target.value)} />
        </Field>
        <Field label="Starts (optional)">
          <Input type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />
        </Field>
        <Field label="Ends (optional)">
          <Input type="datetime-local" value={endAt} onChange={(e) => setEndAt(e.target.value)} />
        </Field>
      </div>

      <div className="flex flex-wrap gap-5">
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={freeShipping}
            onChange={(e) => setFreeShipping(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
          />
          Free shipping
        </label>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={stackable}
            onChange={(e) => setStackable(e.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent"
          />
          Stackable with other coupons
        </label>
      </div>

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={submitting || code.trim().length < 3}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
        {footer}
      </div>
    </form>
  );
}
