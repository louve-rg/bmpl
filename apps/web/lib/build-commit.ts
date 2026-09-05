/**
 * What GET /health reports as this build's commit (BMPL-67).
 *
 * Mirrors the API's /api/health reasoning (apps/api health.controller.ts):
 * a build that does not know its commit answers `null`, never a placeholder —
 * an empty answer is not a negative answer, and a wrong value is worse than no
 * value. deploy-status treats a missing/empty commit as UNKNOWN, which is the
 * verdict an unidentifiable build deserves. Sliced to 7 like the API's.
 */
export function reportedCommit(raw: string | undefined | null): string | null {
  const sha = raw?.trim();
  return sha ? sha.slice(0, 7) : null;
}
