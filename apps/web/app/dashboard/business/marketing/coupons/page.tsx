'use client';

import { useCallback, useEffect, useState } from 'react';
import { type CouponStatus } from '@bmpl/shared';
import { type ApiError } from '../../../../../lib/api';
import { marketingApi, formatDiscount, formatBZD, fmtDate, type Coupon } from '../../../../../lib/marketing';
import { BusinessMarketingGate } from '../../../../../components/marketing/BusinessMarketingGate';
import { StatusBadge } from '../../../../../components/marketing/StatusBadge';
import { CouponForm, type CouponFormValues } from '../../../../../components/marketing/CouponForm';
import { Alert, Button, Card, EmptyState, PageHeader, Spinner } from '../../../../../components/ui';

export default function CouponsPage() {
  const [items, setItems] = useState<Coupon[]>([]);
  const [loading, setLoading] = useState(true);
  const [notBusiness, setNotBusiness] = useState(false);
  const [notVendor, setNotVendor] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setItems(await marketingApi.coupons());
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 403) {
        // The controller admits any business role, but coupons need a vendor profile.
        if (/vendor profile/i.test(err.message ?? '')) setNotVendor(true);
        else setNotBusiness(true);
      } else setError(err.message ?? 'Failed to load.');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  async function refresh() {
    try {
      setItems(await marketingApi.coupons());
    } catch {
      /* keep last-known list */
    }
  }

  async function run(fn: () => Promise<unknown>) {
    setError(null);
    setBusy(true);
    try {
      await fn();
      await refresh();
    } catch (e) {
      setError((e as ApiError).message ?? 'Action failed.');
    } finally {
      setBusy(false);
    }
  }

  async function create(values: CouponFormValues) {
    await run(async () => {
      await marketingApi.createCoupon({
        code: values.code,
        discountType: values.discountType,
        percentOff: values.percentOff,
        amountOffMinor: values.amountOffMinor,
        freeShipping: values.freeShipping,
        minSpendMinor: values.minSpendMinor,
        maxDiscountMinor: values.maxDiscountMinor,
        maxUses: values.maxUses,
        perUserLimit: values.perUserLimit,
        stackable: values.stackable,
        startAt: values.startAt,
        endAt: values.endAt,
      });
      setCreating(false);
    });
  }

  async function update(couponId: string, values: CouponFormValues) {
    await run(async () => {
      // code + discountType are immutable server-side; omit them.
      await marketingApi.updateCoupon(couponId, {
        percentOff: values.percentOff,
        amountOffMinor: values.amountOffMinor,
        freeShipping: values.freeShipping,
        minSpendMinor: values.minSpendMinor,
        maxDiscountMinor: values.maxDiscountMinor,
        maxUses: values.maxUses,
        perUserLimit: values.perUserLimit,
        stackable: values.stackable,
        startAt: values.startAt,
        endAt: values.endAt,
      });
      setEditingId(null);
    });
  }

  function setStatus(couponId: string, status: CouponStatus) {
    void run(() => marketingApi.setCouponStatus(couponId, status));
  }

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  }
  if (notBusiness) return <BusinessMarketingGate />;
  if (notVendor) {
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <PageHeader eyebrow="Marketing" title="Coupons" />
        <EmptyState
          title="Coupons are for stores"
          description="Coupons apply to marketplace orders, so they're available to vendors with a store. Set up your store to start offering discount codes to your customers."
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <PageHeader
        eyebrow="Marketing"
        title="Coupons"
        description="Discount codes for your store. Validation is enforced at checkout."
        actions={
          <Button variant={creating ? 'ghost' : 'primary'} onClick={() => { setCreating((v) => !v); setEditingId(null); }}>
            {creating ? 'Cancel' : 'New coupon'}
          </Button>
        }
      />
      {error && <Alert tone="error">{error}</Alert>}

      {creating && (
        <Card className="p-5">
          <h2 className="bmpl-eyebrow mb-4">New coupon</h2>
          <CouponForm submitting={busy} submitLabel="Create coupon" onSubmit={create} />
        </Card>
      )}

      {items.length === 0 ? (
        <EmptyState title="No coupons yet" description="Create a discount code to promote your store." />
      ) : (
        <div className="space-y-3">
          {items.map((c) => (
            <Card key={c.id} className="p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-mono text-sm font-bold text-belize-navy">{c.code}</p>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {formatDiscount(c)}
                    {c.minSpendMinor != null ? ` · min ${formatBZD(c.minSpendMinor)}` : ''}
                    {` · used ${c.usedCount}${c.maxUses != null ? `/${c.maxUses}` : ''}`}
                    {c.endAt ? ` · ends ${fmtDate(c.endAt)}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge status={c.status} kind="coupon" />
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setEditingId(editingId === c.id ? null : c.id); setCreating(false); }}>
                    {editingId === c.id ? 'Close' : 'Edit'}
                  </Button>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap gap-2">
                {c.status !== 'ACTIVE' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(c.id, 'ACTIVE')}>
                    Activate
                  </Button>
                )}
                {c.status === 'ACTIVE' && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => setStatus(c.id, 'INACTIVE')}>
                    Deactivate
                  </Button>
                )}
                {c.status !== 'DISABLED' && (
                  <Button size="sm" variant="ghost" disabled={busy} onClick={() => setStatus(c.id, 'DISABLED')}>
                    Disable
                  </Button>
                )}
              </div>

              {editingId === c.id && (
                <div className="mt-4 border-t border-slate-100 pt-4">
                  <CouponForm
                    initial={c}
                    submitting={busy}
                    submitLabel="Save changes"
                    onSubmit={(values) => update(c.id, values)}
                  />
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
