import Link from 'next/link';
import { redirect } from 'next/navigation';
import { serverGet } from '../../lib/server-api';
import { Sidebar } from '../../components/dashboard/Sidebar';
import { MobileNavDrawer } from '../../components/dashboard/MobileNavDrawer';
import { AvatarRequiredBanner } from '../../components/dashboard/AvatarRequiredBanner';
import { NotificationBell } from '../../components/notifications/NotificationBell';
import { BrandLockup } from '../../components/Logo';
import { Avatar } from '../../components/Avatar';
import { TerminalMembershipProvider } from '../../lib/terminal-membership-context';
import type { MeView } from '../../lib/types';

export const dynamic = 'force-dynamic';

export default async function DashboardLayout({ children }: { children: React.ReactNode }) {
  const me = await serverGet<MeView>('/me');
  if (!me) redirect('/login');

  return (
    // min-w-0 on the flex child + overflow-x-hidden here: a single wide table or
    // long address inside a page must not make the whole dashboard scroll
    // sideways on a phone.
    // data-theme="glass" + .bml-mural: the Liquid Glass redesign's scope
    // boundary (stage 1 -- tokens only; Sidebar/header chrome itself is
    // restyled in stage 2). Public/marketing pages and /login are outside
    // this wrapper and keep the existing light theme untouched.
    // TERM-NAV-COST: one TerminalMembershipProvider wraps the whole shell,
    // so the real /terminal/me check runs exactly once per page load --
    // Sidebar's and MobileNavDrawer's own copies of DashboardNavList (both
    // always mounted; CSS hides one per breakpoint) and any page under
    // `children` (TerminalWorkspaceBanner on /dashboard) all read the same
    // result instead of each firing its own fetch and its own retry loop.
    <TerminalMembershipProvider>
      <div data-theme="glass" className="min-h-screen overflow-x-hidden bml-mural md:flex">
        <Sidebar me={me} />
        <main className="flex min-w-0 flex-1 flex-col">
          <header
            className="glass-chrome sticky top-0 z-30 flex items-center gap-2 px-3 py-2 md:justify-end md:px-8 md:py-2.5"
            style={{ paddingTop: 'max(0.5rem, env(safe-area-inset-top))' }}
          >
            {/* Phone/tablet: hamburger + brand. Both are hidden from `md` up, where
                the sidebar carries the brand and the navigation. */}
            <MobileNavDrawer me={me} />
            <Link href="/" className="min-w-0 rounded-bmpl-md bg-belize-navy px-2 py-1.5 md:hidden">
              <BrandLockup allowTruncate />
            </Link>
            {/* relative md:static: below md the bell's own dropdown panel (absolute
                right-0) needs ITS positioned ancestor to be this flush-right group,
                not the bell's own wrapper -- the avatar link sitting to the bell's
                right inside this same group is what pushes the panel's left edge
                past the viewport's left edge otherwise (NotificationBell.tsx's
                "md:relative" pairs with this). At md+ this group goes back to
                static and the bell's own wrapper resumes being the anchor, exactly
                today's unchanged desktop placement. */}
            <div className="relative ml-auto flex shrink-0 items-center gap-1 md:static md:gap-3">
              {/* Approved roles only: a pending driver application should not make
                  delivery notifications open the driver job screen. */}
              <NotificationBell
                roleCodes={me.roles.filter((r) => r.status === 'APPROVED').map((r) => r.roleCode)}
              />
              <Link
                href="/dashboard/profile"
                aria-label="Your profile"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
              >
                <Avatar name={`${me.firstName} ${me.lastName}`} src={me.avatarUrl} size="sm" />
              </Link>
            </div>
          </header>
          <AvatarRequiredBanner me={me} />
          {/* lg:p-8, not md:p-8 (WEB-768-PINCH-POINT): the Sidebar is `hidden
              md:flex md:w-72` -- it only starts costing 288px at the exact
              same width (768px) this padding used to jump by 24px more, so
              content width actually DIPS going from 640px (no sidebar, p-5)
              to 768px (sidebar + the old p-8), before recovering as the
              viewport keeps growing. A PageHeader title/description column
              measured with zero scrollWidth/clientWidth margin at 768px
              under this app's own (never-loaded, see glass.css's
              `--font-sans: 'Inter', ...`) font-fallback chain -- any
              environment whose fallback renders a few px wider than this
              one's tips it into the real, CI-only overflow
              driver-job-detail-free-text-overflow.spec.ts caught. Moving
              the padding step to lg removes the coincidence rather than
              chasing the specific font: p-5 still applies through the
              768-1023px range where the sidebar is now also active, so
              there's real margin instead of exactly none. */}
          <div className="min-w-0 flex-1 p-4 sm:p-5 lg:p-8">{children}</div>
        </main>
      </div>
    </TerminalMembershipProvider>
  );
}
