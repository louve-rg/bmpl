'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { paymentsApi, money, type PaymentDetail } from '../../../lib/payments';
import { PaymentStatusBadge, HoldStatusBadge } from '../../../components/payments/PaymentStatusBadge';
import type { ApiError } from '../../../lib/api';
import { Alert, Button, Card, PageHeader, Spinner } from '../../../components/ui';

export default function PaymentDetailPage() {
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const [p, setP] = useState<PaymentDetail | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'notfound' | 'error'>('loading');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null);

  useEffect(() => {
    paymentsApi
      .getOwn(params.id)
      .then((r) => {
        setP(r);
        setState('ready');
      })
      .catch((e) => {
        const err = e as ApiError;
        if (err.status === 401) router.push(`/login?next=${encodeURIComponent(`/payments/${params.id}`)}`);
        else setState(err.status === 404 ? 'notfound' : 'error');
      });
  }, [params.id, router]);

  async function authorize() {
    setBusy(true);
    setMsg(null);
    try {
      const updated = await paymentsApi.authorize(params.id);
      setP(updated);
      setMsg({ kind: 'ok', text: 'Payment authorized — funds are held in escrow.' });
    } catch (e) {
      const err = e as ApiError;
      if (err.status === 401) return router.push(`/login?next=${encodeURIComponent(`/payments/${params.id}`)}`);
      // Refresh so the UI reflects any rollback (payment FAILED, order cancelled).
      paymentsApi.getOwn(params.id).then(setP).catch(() => {});
      setMsg({ kind: 'err', text: /insufficient/i.test(err.message) ? 'Insufficient funds in your wallet.' : err.message || 'Authorization failed.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <Link href="/payments" className="text-sm text-belize-blue hover:underline">← Payments</Link>

        {state === 'loading' && (
          <div className="mt-8 flex flex-col items-center gap-3 rounded-bmpl-xl border border-slate-200 bg-white p-14 text-center">
            <Spinner />
            <p className="text-sm text-slate-400">Loading…</p>
          </div>
        )}
        {state === 'notfound' && (
          <div className="mt-8 rounded-bmpl-xl border border-slate-200 bg-white p-10 text-center text-slate-400">Payment not found.</div>
        )}
        {state === 'error' && <Alert tone="error" title="We couldn’t load this payment." className="mt-8" />}

        {state === 'ready' && p && (
          <>
            <div className="mt-4">
              <PageHeader
                title={p.paymentNumber}
                description={new Date(p.createdAt).toLocaleString()}
                actions={
                  <div className="flex items-center gap-3">
                    <Link href={`/orders/${p.order.id}`} className="text-sm text-belize-blue hover:underline">
                      Order {p.order.orderNumber}
                    </Link>
                    <PaymentStatusBadge status={p.status} />
                  </div>
                }
              />
            </div>

            {/* Authorization panel — status-aware (M12) */}
            {p.status === 'AUTHORIZED' ? (
              <Alert tone="success" title="✓ Payment authorized">
                Your funds ({money(p.amountMinor)}) are held in <strong>escrow</strong> under BMPL until fulfilment. No vendor has been paid.
              </Alert>
            ) : p.status === 'FAILED' ? (
              <Alert tone="error" title="Authorization failed">
                This payment could not be authorized and the order was cancelled. No funds moved.
              </Alert>
            ) : p.status === 'CANCELLED' ? (
              <Alert tone="neutral">This payment was cancelled. No funds moved.</Alert>
            ) : (
              <Alert tone="warning" title="Pending authorization">
                <p>Authorize {money(p.amountMinor)} from your wallet — the funds move into escrow (held by BMPL, not paid to the vendor).</p>
                <Button type="button" onClick={authorize} disabled={busy} className="mt-3">
                  {busy ? 'Authorizing…' : 'Authorize with wallet'}
                </Button>
                {msg && (
                  <p role="status" className={`mt-2 text-sm font-medium ${msg.kind === 'ok' ? 'text-emerald-600' : 'text-red-600'}`}>
                    {msg.text}
                  </p>
                )}
              </Alert>
            )}

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <Card className="p-4">
                <h2 className="bmpl-label">Payment</h2>
                <dl className="mt-2 space-y-1.5 text-sm">
                  <div className="flex justify-between"><dt className="text-slate-500">Method</dt><dd className="font-medium">{p.methodType === 'WALLET' ? 'Platform wallet' : p.methodType}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Amount</dt><dd className="font-semibold text-belize-navy">{money(p.amountMinor)} {p.currency}</dd></div>
                  <div className="flex justify-between"><dt className="text-slate-500">Status</dt><dd><PaymentStatusBadge status={p.status} /></dd></div>
                </dl>
              </Card>

              <Card className="p-4">
                <h2 className="bmpl-label">Wallet hold</h2>
                {p.holds.length === 0 ? (
                  <p className="mt-2 text-sm text-slate-400">No hold.</p>
                ) : (
                  p.holds.map((h) => (
                    <div key={h.id} className="mt-2 flex items-center justify-between text-sm">
                      <span className="text-slate-600">{money(h.amountMinor)} {h.currency}</span>
                      <HoldStatusBadge status={h.status} />
                    </div>
                  ))
                )}
                <p className="mt-2 text-xs text-slate-400">A hold reserves your intent to pay. It does not move money.</p>
              </Card>
            </div>

            <Card className="mt-6 overflow-hidden">
              <header className="border-b border-slate-100 px-4 py-3 text-sm font-semibold text-belize-navy">Activity</header>
              <ul className="divide-y divide-slate-100 text-sm">
                {p.events.map((e, i) => (
                  <li key={i} className="flex items-center justify-between px-4 py-2.5">
                    <span className="text-slate-600">
                      {e.type === 'STATE_CHANGED' ? `Status: ${e.fromStatus} → ${e.toStatus}` : e.type.replace(/_/g, ' ').toLowerCase()}
                    </span>
                    <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            </Card>
          </>
        )}
      </main>
      <Footer />
    </>
  );
}
