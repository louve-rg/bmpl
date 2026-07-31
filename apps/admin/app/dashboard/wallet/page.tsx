'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';
import { StatusBadge } from '../../../components/StatusBadge';
import { Card, EmptyState, PageHeader, Spinner } from '../../../components/ui';

interface Account { id: string; type: string; currency: string; status: string; cachedBalanceMinor: number }
interface Entry { direction: string; amountMinor: number; accountType: string; isCustomer: boolean }
interface Txn { id: string; type: string; status: string; currency: string; reference: string | null; createdAt: string; entries: Entry[]; balanced: boolean }

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

/** Read-only wallet visibility (M12): escrow/system balances + double-entry
 *  transactions. No manual adjustments. */
export default function AdminWalletPage() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [txns, setTxns] = useState<Txn[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([api.get<Account[]>('/admin/wallet/accounts'), api.get<Txn[]>('/admin/wallet/transactions')])
      .then(([a, t]) => { setAccounts(a); setTxns(t); })
      .finally(() => setLoading(false));
  }, []);

  return (
    <div>
      <PageHeader
        eyebrow="Finance"
        title="Wallet & Escrow"
        description="Read-only double-entry ledger. Money moves only between customer wallets and escrow (M12)."
      />

      {loading ? (
        <div className="flex items-center gap-2 text-sm text-slate-500">
          <Spinner className="h-4 w-4" /> Loading…
        </div>
      ) : (
        <>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">System / escrow balances</h2>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <Card key={a.id} className="p-4">
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{a.type.replace(/_/g, ' ')}</p>
                <p className="mt-1.5 text-xl font-bold text-belize-navy">{money(a.cachedBalanceMinor)} <span className="text-xs font-normal text-slate-400">{a.currency}</span></p>
                <div className="mt-2">
                  <StatusBadge status={a.status} />
                </div>
              </Card>
            ))}
            {accounts.length === 0 && (
              <div className="sm:col-span-2 lg:col-span-3">
                <EmptyState title="No system accounts yet" description="Escrow and platform accounts will appear here once created." />
              </div>
            )}
          </div>

          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Transactions</h2>
          {txns.length === 0 ? (
            <EmptyState title="No transactions yet" description="Ledger transactions will appear here as they are posted." />
          ) : (
            <div className="overflow-x-auto rounded-bmpl-xl border border-slate-200 bg-white">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-50 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">Type</th>
                    <th className="px-4 py-3">Entries (debit / credit)</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Balanced</th>
                    <th className="px-4 py-3">When</th>
                  </tr>
                </thead>
                <tbody>
                  {txns.map((t) => (
                    <tr key={t.id} className="border-t border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-3"><p className="font-medium text-belize-navy">{t.type.replace(/_/g, ' ')}</p><p className="text-xs text-slate-400">{t.reference}</p></td>
                      <td className="px-4 py-3 text-slate-600">
                        {t.entries.map((e, i) => (
                          <span key={i} className="mr-2 inline-block">{e.direction === 'DEBIT' ? '−' : '+'}{money(e.amountMinor)} {e.isCustomer ? 'customer' : e.accountType.replace(/_/g, ' ')}</span>
                        ))}
                      </td>
                      <td className="px-4 py-3"><StatusBadge status={t.status} /></td>
                      <td className="px-4 py-3"><StatusBadge status={t.balanced ? 'BALANCED' : 'UNBALANCED'} /></td>
                      <td className="px-4 py-3 text-xs text-slate-400">{new Date(t.createdAt).toLocaleString()}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}
