import { type PropertyStatus } from '@bmpl/shared';
import { Card } from '../ui';
import { StatusBadge } from './StatusBadge';

export interface Stat {
  label: string;
  value: number | string;
}

/** Stat-tile grid + a status breakdown, shared by owner and agent analytics. */
export function AnalyticsPanel({
  stats,
  byStatus,
}: {
  stats: Stat[];
  byStatus: Array<{ status: PropertyStatus; count: number }>;
}) {
  return (
    <div className="space-y-6">
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

      {byStatus.length > 0 && (
        <Card className="p-5">
          <h2 className="bmpl-eyebrow mb-3">Listings by status</h2>
          <div className="space-y-2">
            {byStatus.map((r) => (
              <div key={r.status} className="flex items-center justify-between gap-3 text-sm">
                <StatusBadge status={r.status} />
                <span className="font-semibold text-belize-navy">{r.count}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
