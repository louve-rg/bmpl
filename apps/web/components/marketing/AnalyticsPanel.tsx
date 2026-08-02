import { PROMOTION_STATUS_LABELS, type PromotionStatus } from '@bmpl/shared';
import { Card } from '../ui';
import { formatCtr, type MetricTotals, type TopPromotion } from '../../lib/marketing';
import { StatusBadge } from './StatusBadge';

export interface Stat {
  label: string;
  value: number | string;
}

/** Stat-tile grid used by the marketing overview and per-promotion analytics. */
export function StatGrid({ stats }: { stats: Stat[] }) {
  return (
    <Card className="p-5">
      <h2 className="bmpl-eyebrow mb-3">Overview</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {stats.map((s) => (
          <div key={s.label}>
            <p className="text-2xl font-bold text-belize-navy">{s.value}</p>
            <p className="text-xs text-slate-500">{s.label}</p>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Engagement totals (impressions/views/clicks/conversions/CTR) as a stat row. */
export function EngagementTotals({ totals, title = 'Engagement' }: { totals: MetricTotals; title?: string }) {
  return (
    <Card className="p-5">
      <h2 className="bmpl-eyebrow mb-3">{title}</h2>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5">
        <div>
          <p className="text-2xl font-bold text-belize-navy">{totals.impressions.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Impressions</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-belize-navy">{totals.views.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Views</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-belize-navy">{totals.clicks.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Clicks</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-belize-navy">{totals.conversions.toLocaleString()}</p>
          <p className="text-xs text-slate-500">Conversions</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-belize-navy">{formatCtr(totals.ctr)}</p>
          <p className="text-xs text-slate-500">CTR</p>
        </div>
      </div>
    </Card>
  );
}

/** Promotion-count breakdown by status. */
export function ByStatus({ byStatus }: { byStatus: Array<{ status: PromotionStatus; count: number }> }) {
  if (byStatus.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="bmpl-eyebrow mb-3">Promotions by status</h2>
      <div className="space-y-2">
        {byStatus.map((r) => (
          <div key={r.status} className="flex items-center justify-between gap-3 text-sm">
            <StatusBadge status={r.status} kind="promotion" />
            <span className="font-semibold text-belize-navy">{r.count}</span>
          </div>
        ))}
      </div>
    </Card>
  );
}

/** Top performing promotions by views. */
export function TopPromotions({ items }: { items: TopPromotion[] }) {
  if (items.length === 0) return null;
  return (
    <Card className="p-5">
      <h2 className="bmpl-eyebrow mb-3">Top promotions</h2>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[28rem] text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2 pr-3 font-semibold">Promotion</th>
              <th className="pb-2 pr-3 font-semibold">Views</th>
              <th className="pb-2 pr-3 font-semibold">Clicks</th>
              <th className="pb-2 font-semibold">CTR</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-slate-100">
                <td className="py-2 pr-3">
                  <span className="font-medium text-belize-navy">{p.title}</span>
                  <span className="ml-2 text-xs text-slate-400">{PROMOTION_STATUS_LABELS[p.status]}</span>
                </td>
                <td className="py-2 pr-3 text-slate-600">{p.views.toLocaleString()}</td>
                <td className="py-2 pr-3 text-slate-600">{p.clicks.toLocaleString()}</td>
                <td className="py-2 text-slate-600">{formatCtr(p.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
