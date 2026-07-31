import Link from 'next/link';
import { redirect } from 'next/navigation';
import { StorefrontView, type Storefront } from '../../../../components/storefront/StorefrontView';
import { serverGet } from '../../../../lib/server-api';
import { Alert, StatusBadge } from '../../../../components/ui';

export const dynamic = 'force-dynamic';

type Preview = Storefront & { preview: boolean; approvalStatus: string };

export default async function StorePreviewPage() {
  let data: Preview | null = null;
  try {
    data = await serverGet<Preview>('/vendor/profile/preview');
  } catch {
    data = null; // no profile / not a vendor
  }
  if (!data) redirect('/dashboard/store');

  const live = data.approvalStatus === 'APPROVED';
  return (
    <div>
      <Alert tone="warning" className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <span className="flex flex-wrap items-center gap-2">
          <b>Preview</b> — this is how customers will see your storefront.
          <StatusBadge status={data.approvalStatus} />
          <span>{live ? '(live)' : '(not public yet)'}</span>
        </span>
        <Link href="/dashboard/store" className="text-sm font-semibold text-belize-blue hover:underline">
          ← Back to My Store
        </Link>
      </Alert>

      <div className="overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
        <StorefrontView store={data} />
      </div>

      {live && (
        <p className="mt-3 text-sm text-slate-500">
          Live at{' '}
          <Link href={`/store/${data.slug}`} className="text-belize-blue hover:underline">
            /store/{data.slug}
          </Link>
        </p>
      )}
    </div>
  );
}
