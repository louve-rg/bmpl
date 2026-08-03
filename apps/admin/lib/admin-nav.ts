/**
 * Admin breadcrumb hierarchy — single source of truth (M26.2).
 * The admin portal is rooted at `/dashboard` ("Admin"). Every page builds its trail
 * with `adminCrumbs(...)`, so breadcrumb markup is never duplicated and always matches
 * the route hierarchy. A detail/edit page passes its parent list as a `[label, href]`
 * tuple (a real link back to the list) and its own entity as a trailing string (the
 * current page — rendered unlinked with aria-current). Deep links get a safe trail
 * because it is derived from static route structure, not browser history.
 */
import type { Crumb } from '../components/ui';

/** A segment: a plain label (current page, no link) or `[label, href]` (a linked ancestor). */
export type Seg = string | [string, string];

export const ADMIN_ROOT: Crumb = { label: 'Admin', href: '/dashboard' };

export function adminCrumbs(...segs: Seg[]): Crumb[] {
  const out: Crumb[] = [ADMIN_ROOT];
  segs.forEach((s, i) => {
    const isLast = i === segs.length - 1;
    if (Array.isArray(s)) {
      // A tuple links unless it is the current (last) page.
      out.push(isLast ? { label: s[0] } : { label: s[0], href: s[1] });
    } else {
      out.push({ label: s });
    }
  });
  return out;
}
