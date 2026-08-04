import type { NextFunction, Request, Response } from 'express';

const IMAGE_CONTENT_TYPE = /^image\/(jpeg|png|webp)\b/i;

/**
 * Express middleware that buffers the raw request body into `req.body` for product
 * IMAGE uploads. Product images are posted as raw bytes (browser → same-origin web
 * `/api` proxy → API → storage) so uploads never make a cross-origin browser PUT to
 * the storage endpoint (the "Load failed" cause on mobile Safari).
 *
 * Scoped by Content-Type so JSON/urlencoded request bodies are left untouched (their
 * parsers run first and skip image types, leaving the stream intact). Enforces a hard
 * byte cap and returns 413 when exceeded. Implemented with Node stream APIs only, so
 * there is no runtime import of express's body parsers (which pnpm does not expose to
 * this package) — only type-only imports, which are erased at build time.
 */
export function rawImageBody(limitBytes: number) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const type = req.headers['content-type'] ?? '';
    if (req.method !== 'POST' || !IMAGE_CONTENT_TYPE.test(type)) {
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
            .json({ statusCode: 413, error: 'Payload Too Large', message: 'The image is too large.' });
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
