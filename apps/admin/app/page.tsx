import { redirect } from 'next/navigation';

/**
 * ADMIN-ROOT-404: without this, Next statically prerenders this page at
 * build time with no request to redirect -- the redirect became inert
 * build-time data (confirmed: `"digest":"NEXT_REDIRECT;replace;/dashboard;307;"`
 * baked into the static RSC payload) and the static output fell back to its
 * not-found page instead, served with an incorrect 307 status. Forcing this
 * dynamic makes the redirect run per-request instead. `apps/web/app/page.tsx`
 * and `apps/admin/app/dashboard/page.tsx` already opt out of static
 * generation the same way (for their own, data-dependent reasons) --
 * this page needed the same opt-out for a redirect-dependent one.
 */
export const dynamic = 'force-dynamic';

export default function AdminRoot() {
  redirect('/dashboard');
}
