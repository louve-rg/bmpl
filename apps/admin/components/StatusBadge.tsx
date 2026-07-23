const STYLES: Record<string, string> = {
  APPROVED: 'bg-green-100 text-green-700',
  PENDING: 'bg-amber-100 text-amber-700',
  MORE_INFO_REQUIRED: 'bg-blue-100 text-blue-700',
  REJECTED: 'bg-red-100 text-red-700',
  SUSPENDED: 'bg-orange-100 text-orange-700',
  REVOKED: 'bg-slate-200 text-slate-700',
  ACTIVE: 'bg-green-100 text-green-700',
  DEACTIVATED: 'bg-slate-200 text-slate-700',
  WITHDRAWN: 'bg-slate-200 text-slate-700',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-semibold ${
        STYLES[status] ?? 'bg-slate-100 text-slate-600'
      }`}
    >
      {status.replace(/_/g, ' ')}
    </span>
  );
}
