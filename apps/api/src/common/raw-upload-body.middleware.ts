import type { NextFunction, Request, Response } from 'express';

/**
 * Content types posted as raw bytes: public marketplace images plus the private
 * document formats (role-application / KYC uploads, which are commonly PDFs and
 * — from iPhones — HEIC).
 *
 * `application/octet-stream` is included because browsers report an empty
 * `File.type` for some files (notably .heic on certain platforms) and the client
 * falls back to it. Buffering it is safe: no other route accepts an octet-stream
 * body, and every upload service sniffs the REAL type from the bytes and rejects
 * anything off its allow-list, so a mislabelled Content-Type grants nothing.
 */
const RAW_UPLOAD_CONTENT_TYPE =
  /^(image\/(jpeg|png|webp|heic)|application\/(pdf|octet-stream))\b/i;

/**
 * Express middleware that buffers the raw request body into `req.body` for binary
 * uploads. Images and documents are posted as raw bytes (browser → same-origin web
 * `/api` proxy → API → storage) so uploads never make a cross-origin browser PUT to
 * the storage endpoint — the cause of "Load failed" on mobile Safari and "Failed to
 * fetch" elsewhere, since the R2 bucket has no CORS policy for the custom domain.
 *
 * Scoped by Content-Type so JSON/urlencoded request bodies are left untouched (their
 * parsers run first and skip these types, leaving the stream intact). Enforces a hard
 * byte cap and returns 413 when exceeded; each service re-checks the exact per-kind
 * limit against the real buffer. Implemented with Node stream APIs only, so there is
 * no runtime import of express's body parsers (which pnpm does not expose to this
 * package) — only type-only imports, which are erased at build time.
 */
export function rawUploadBody(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const type = req.headers['content-type'] ?? '';
    if (req.method !== 'POST' || !RAW_UPLOAD_CONTENT_TYPE.test(type)) {
      next();
      return;
    }
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const finish = (fn: () => void): void => {
      if (!done) {
        done = true;
        fn();
      }
    };
    req.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > limitBytes) {
        finish(() => {
          res
            .status(413)
            .json({ statusCode: 413, error: 'Payload Too Large', message: 'The file is too large.' });
          req.destroy();
        });
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () =>
      finish(() => {
        (req as Request & { body: Buffer }).body = Buffer.concat(chunks);
        next();
      }),
    );
    req.on('error', () => finish(() => next()));
  };
}
