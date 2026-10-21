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
        <p className="mt-3 text-sm text-[color:var(--bmpl-text-muted)]">
          Live at{' '}
          {/* No card ancestor -- a sibling of the data-theme="light" frame
              above, not a descendant, so that fix cannot reach it. Same
              defect shape as Breadcrumbs' link branch (both apps'
              components/ui.tsx): a hardcoded belize-blue sitting directly
              on the mural. Same fix. */}
          <Link
            href={`/store/${data.slug}`}
            className="font-semibold text-[color:var(--bmpl-text-muted)] underline transition hover:text-[color:var(--bmpl-text)]"
          >
            /store/{data.slug}
          </Link>
        </p>
      )}
    </div>
  );
}
