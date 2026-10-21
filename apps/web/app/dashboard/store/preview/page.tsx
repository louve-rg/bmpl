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

      {/* data-theme="light" -- this frame deliberately simulates the PUBLIC
          /store/[slug] page, which never sits under the dashboard's glass
          scope. Without this, StorefrontView's token-driven elements (e.g.
          the sidebar .bmpl-card) would still inherit this route's glass
          ancestor despite the literal bg-white below, and render with dark
          glass surface/text tokens composited against white -- wrong by
          construction, not merely by appearance. See packages/ui/src/glass.css's
          [data-theme='light'] comment for the mechanism. */}
      <div data-theme="light" className="overflow-hidden rounded-bmpl-xl border border-slate-200 bg-white shadow-bmpl-sm">
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
