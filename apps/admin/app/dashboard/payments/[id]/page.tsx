'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { api } from '../../../../lib/api';
import { StatusBadge } from '../../../../components/StatusBadge';
import { Card, Spinner } from '../../../../components/ui';

interface Hold { id: string; status: string; amountMinor: number; currency: string; heldAt: string; releasedAt: string | null; releaseReason: string | null }
interface LedgerRef { id: string; purpose: string; direction: string; amountMinor: number; status: string; walletTransactionId: string | null }
interface Event { type: string; fromStatus: string | null; toStatus: string | null; createdAt: string }
interface AdminPayment {
  id: string;
  paymentNumber: string;
  status: string;
  methodType: string;
  amountMinor: number;
  currency: string;
  createdAt: string;
  customer: { name: string; email: string };
  order: { id: string; orderNumber: string; totalMinor: number; vendorOrders: Array<{ id: string; orderNumber: string; businessName: string; subtotalMinor: number }> };
  holds: Hold[];
  ledgerReferences: LedgerRef[];
  events: Event[];
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export default function AdminPaymentDetailPage() {
  const params = useParams<{ id: string }>();
  const [p, setP] = useState<AdminPayment | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  useEffect(() => {
    api.get<AdminPayment>(`/admin/payments/${params.id}`).then((r) => { setP(r); setState('ready'); }).catch(() => setState('error'));
  }, [params.id]);

  if (state === 'loading')
    return (
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Spinner className="h-4 w-4" /> Loading…
      </div>
    );
  if (state === 'error' || !p) return <p className="text-sm text-slate-500">Payment not found.</p>;

  return (
    <div>
      <Link href="/dashboard/payments" className="text-sm font-medium text-belize-blue hover:underline">← Payments</Link>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="bmpl-page-title">{p.paymentNumber}</h1>
          <p className="mt-1 text-sm text-slate-500">{p.customer.name} · {p.customer.email} · Order {p.order.orderNumber} · {new Date(p.createdAt).toLocaleString()}</p>
        </div>
        <StatusBadge status={p.status} />
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Amount</p>
          <p className="mt-1 text-lg font-bold text-belize-navy">{money(p.amountMinor)} {p.currency}</p>
          <p className="text-xs text-slate-500">{p.methodType === 'WALLET' ? 'Platform wallet' : p.methodType}</p>
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Wallet holds</p>
          {p.holds.length === 0 ? <p className="mt-1 text-slate-400">None</p> : p.holds.map((h) => (
            <p key={h.id} className="mt-1 text-slate-600">{money(h.amountMinor)} — <span className={h.status === 'HELD' ? 'text-amber-600' : 'text-slate-400'}>{h.status}</span></p>
          ))}
        </Card>
        <Card className="p-4 text-sm">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Ledger references</p>
          {p.ledgerReferences.length === 0 ? <p className="mt-1 text-slate-400">None</p> : p.ledgerReferences.map((l) => (
            <p key={l.id} className="mt-1 text-slate-600">{l.direction} {money(l.amountMinor)} — <span className="text-slate-400">{l.status}</span>{l.walletTransactionId ? ` · tx ${l.walletTransactionId}` : ''}</p>
          ))}
        </Card>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card className="overflow-hidden p-0">
          <header className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-belize-navy">Vendor orders</header>
          <ul className="divide-y divide-slate-100 text-sm">
            {p.order.vendorOrders.map((vo) => (
              <li key={vo.id} className="flex justify-between px-4 py-2.5"><span className="text-slate-600">{vo.businessName} · {vo.orderNumber}</span><span className="font-medium text-belize-navy">{money(vo.subtotalMinor)}</span></li>
            ))}
          </ul>
        </Card>
        <Card className="overflow-hidden p-0">
          <header className="border-b border-slate-100 bg-slate-50 px-4 py-3 text-sm font-semibold text-belize-navy">Payment events</header>
          <ul className="divide-y divide-slate-100 text-sm">
            {p.events.map((e, i) => (
              <li key={i} className="flex justify-between px-4 py-2.5">
                <span className="text-slate-600">{e.type === 'STATE_CHANGED' ? `${e.fromStatus} → ${e.toStatus}` : e.type.replace(/_/g, ' ').toLowerCase()}</span>
                <span className="text-xs text-slate-400">{new Date(e.createdAt).toLocaleString()}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </div>
  );
}
