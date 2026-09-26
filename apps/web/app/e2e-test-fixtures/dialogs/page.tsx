import { notFound } from 'next/navigation';
import { DialogFixtureClient } from './DialogFixtureClient';

/**
 * TEST FIXTURE — not a real application page (BMPL-217).
 *
 * FullScreenMapModal's and EnlargeableImage's only real hosts fetch their
 * data server-side (StorefrontView via `serverGet`) or require an
 * authenticated driver session, both invisible to Playwright's browser-side
 * `page.route` mocking. Rather than fake a login and a server fetch to reach
 * two components that take plain props and touch neither, this route renders
 * the REAL, unmodified components directly — the same choice already proven
 * out for EnlargeableImage during the BMPL-208 walk (a throwaway scratch
 * route, deleted afterwards). This one is committed instead of thrown away
 * so the walk can be re-run, which is the entire point of BMPL-217.
 *
 * Guarded out of production on purpose: this 404s whenever NODE_ENV is
 * "production" (a real deploy, `next build && next start`), so it is never a
 * reachable route in anything actually serving BML users. `next dev` (what
 * the e2e harness runs) and `vitest` both leave NODE_ENV as "development"/
 * "test", so the guard never fires for the suite that needs the route.
 */
export default function DialogFixturePage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <DialogFixtureClient />;
}
