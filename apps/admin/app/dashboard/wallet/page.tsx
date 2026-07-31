'use client';

import { useEffect, useState } from 'react';
import { api } from '../../../lib/api';

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
      <h1 className="mb-1 text-2xl font-bold text-belize-navy">Wallet & escrow</h1>
      <p className="mb-6 text-sm text-slate-500">Read-only double-entry ledger. Money moves only between customer wallets and escrow (M12).</p>

      {loading ? (
        <p className="text-sm text-slate-500">Loading…</p>
      ) : (
        <>
          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">System / escrow balances</h2>
          <div className="mb-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {accounts.map((a) => (
              <div key={a.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                <p className="text-xs font-medium text-slate-500">{a.type.replace(/_/g, ' ')}</p>
                <p className="mt-1 text-xl font-bold text-belize-navy">{money(a.cachedBalanceMinor)} <span className="text-xs font-normal text-slate-400">{a.currency}</span></p>
                <p className="text-xs text-slate-400">{a.status}</p>
              </div>
            ))}
            {accounts.length === 0 && <p className="text-sm text-slate-400">No system accounts yet.</p>}
          </div>

          <h2 className="mb-2 text-sm font-semibold uppercase text-slate-500">Transactions</h2>
          <div className="overflow-x-auto rounded-2xl border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-4 py-3">Type</th>
                  <th className="px-4 py-3">Entries (debit / credit)</th>
                  <th className="px-4 py-3">Balanced</th>
                  <th className="px-4 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {txns.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3"><p className="font-medium text-belize-navy">{t.type.replace(/_/g, ' ')}</p><p className="text-xs text-slate-400">{t.reference}</p></td>
                    <td className="px-4 py-3 text-slate-600">
                      {t.entries.map((e, i) => (
                        <span key={i} className="mr-2 inline-block">{e.direction === 'DEBIT' ? '−' : '+'}{money(e.amountMinor)} {e.isCustomer ? 'customer' : e.accountType.replace(/_/g, ' ')}</span>
                      ))}
                    </td>
                    <td className="px-4 py-3">{t.balanced ? <span className="text-emerald-600">✓ net 0</span> : <span className="text-red-600">unbalanced</span>}</td>
                    <td className="px-4 py-3 text-xs text-slate-400">{new Date(t.createdAt).toLocaleString()}</td>
                  </tr>
                ))}
                {txns.length === 0 && <tr><td colSpan={4} className="px-4 py-6 text-center text-sm text-slate-400">No transactions yet.</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
