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
            <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{s.value}</p>
            <p className="text-xs text-[color:var(--bmpl-text-muted)]">{s.label}</p>
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
          <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{totals.impressions.toLocaleString()}</p>
          <p className="text-xs text-[color:var(--bmpl-text-muted)]">Impressions</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{totals.views.toLocaleString()}</p>
          <p className="text-xs text-[color:var(--bmpl-text-muted)]">Views</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{totals.clicks.toLocaleString()}</p>
          <p className="text-xs text-[color:var(--bmpl-text-muted)]">Clicks</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{totals.conversions.toLocaleString()}</p>
          <p className="text-xs text-[color:var(--bmpl-text-muted)]">Conversions</p>
        </div>
        <div>
          <p className="text-2xl font-bold text-[color:var(--bmpl-text)]">{formatCtr(totals.ctr)}</p>
          <p className="text-xs text-[color:var(--bmpl-text-muted)]">CTR</p>
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
            <span className="font-semibold text-[color:var(--bmpl-text)]">{r.count}</span>
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
            <tr className="text-left text-xs uppercase tracking-wide text-[color:var(--bmpl-text-faint)]">
              <th className="pb-2 pr-3 font-semibold">Promotion</th>
              <th className="pb-2 pr-3 font-semibold">Views</th>
              <th className="pb-2 pr-3 font-semibold">Clicks</th>
              <th className="pb-2 font-semibold">CTR</th>
            </tr>
          </thead>
          <tbody>
            {items.map((p) => (
              <tr key={p.id} className="border-t border-[color:var(--bmpl-border-soft)]">
                <td className="py-2 pr-3">
                  <span className="font-medium text-[color:var(--bmpl-text)]">{p.title}</span>
                  <span className="ml-2 text-xs text-[color:var(--bmpl-text-faint)]">{PROMOTION_STATUS_LABELS[p.status]}</span>
                </td>
                <td className="py-2 pr-3 text-[color:var(--bmpl-text-muted)]">{p.views.toLocaleString()}</td>
                <td className="py-2 pr-3 text-[color:var(--bmpl-text-muted)]">{p.clicks.toLocaleString()}</td>
                <td className="py-2 text-[color:var(--bmpl-text-muted)]">{formatCtr(p.ctr)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
