import type { Request } from 'express';

/**
 * Helpers for controllers that accept a raw binary body (browser → API → storage).
 *
 * The bytes arrive via the scoped raw-body middleware registered in main.ts, which
 * exposes them as `req.body: Buffer`. Metadata rides on the query string because the
 * body is the file itself.
 */

/** The uploaded bytes, or undefined when the body was not a binary payload. */
export function rawBody(req: Request): Buffer | undefined {
  return Buffer.isBuffer(req.body) ? req.body : undefined;
}

/** The client-supplied original filename (`?filename=…`), used only for key legibility. */
export function uploadFileName(req: Request): string | undefined {
  return (req.query as Record<string, string | undefined>).filename;
}
