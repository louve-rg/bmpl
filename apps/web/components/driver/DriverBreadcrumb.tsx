import Link from 'next/link';

/**
 * "Driver Dashboard → {page}" on every driver sub-page.
 *
 * The client's complaint was landing on a page labelled just "Delivery Driver"
 * with no obvious way back to their dashboard. A one-level trail is enough here:
 * these pages are all direct children of the dashboard, so the only useful
 * upward link is the dashboard itself — and it says "Driver Dashboard", the name
 * the client asked for.
 */
export function DriverBreadcrumb({ current }: { current: string }) {
  return (
    <nav aria-label="Breadcrumb" className="text-sm">
      <ol className="flex flex-wrap items-center gap-1.5 text-slate-500">
        <li>
          <Link href="/dashboard/driver" className="font-medium text-belize-blue transition hover:text-belize-deep hover:underline">
            Driver Dashboard
          </Link>
        </li>
        <li aria-hidden className="text-slate-300">
          /
        </li>
        <li aria-current="page" className="min-w-0 truncate font-medium text-slate-600">
          {current}
        </li>
      </ol>
    </nav>
  );
}
