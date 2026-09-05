import { NextResponse } from 'next/server';
import { reportedCommit } from '../../lib/build-commit';

/**
 * Which commit is this web build? (BMPL-67 — mirrors the API's GET /api/health.)
 *
 * Lives at /health on the WEB origin, deliberately NOT under /api (that whole
 * prefix is rewrite-proxied to the API — a route there would shadow the proxy)
 * and NOT under any middleware-gated prefix (/dashboard/* 307s to /login before
 * the router answers, so a gated path can never prove a route shipped — the
 * exact trap this endpoint exists to close). No auth: a check that needs a
 * login cannot answer "is the site up".
 *
 * `commit` is `null` when the build has no commit identity (a local build, or
 * Vercel's sha absent) — deploy-status reads that as UNKNOWN, which is honest.
 * The value is baked in at build time via next.config's `env` block, so the
 * answer describes the BUILD being served, not the runtime environment.
 * Unlike the API there is no uptime/startedAt: serverless has no long-lived
 * container whose boot time would mean anything, and this endpoint exposes the
 * commit and nothing else.
 */
export function GET() {
  return NextResponse.json({
    status: 'ok',
    commit: reportedCommit(process.env.BMPL_BUILD_COMMIT),
  });
}
