import { BadRequestException, Injectable } from '@nestjs/common';
import {
  documentExt,
  MAX_DOCUMENT_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  MAX_RESUME_BYTES,
  productImageExt,
  resumeExt,
  sniffDocumentMime,
  sniffProductImageMime,
  sniffResumeMime,
} from '@bmpl/shared';
import { StorageService, type Visibility } from './storage.service';

export interface IngestResult {
  key: string;
  contentType: string;
  sizeBytes: number;
}

/**
 * Base name (no directory, no extension) for a client-supplied filename, or a
 * fallback when absent/unusable. Character sanitizing is left to
 * StorageService.buildKey; this only strips path segments and the old extension.
 */
export function uploadBaseName(fileName: string | undefined, fallback: string): string {
  const base = (fileName ?? '').split(/[\\/]/).pop() ?? '';
  const stem = base.replace(/\.[^.]+$/, '').trim();
  return stem.length > 0 ? stem.slice(0, 60) : fallback;
}

/**
 * Server-side upload ingest (browser → API → storage), shared by every upload
 * surface on the platform.
 *
 * The browser POSTs raw file bytes through the same-origin web `/api` proxy and the
 * API streams them to object storage. Nothing is ever PUT to the storage endpoint by
 * the browser: that request is cross-origin, the R2 bucket has no CORS policy for the
 * custom domain, and it fails as "Load failed" (Safari) / "Failed to fetch"
 * (Chrome, Firefox).
 *
 * Two guarantees every caller inherits:
 *  - the REAL media type is sniffed from the bytes, so a client-declared
 *    Content-Type is never trusted, and the stored extension always matches it;
 *  - the size cap is enforced on the actual buffer, not a self-reported length.
 */
@Injectable()
export class UploadIngestService {
  constructor(private readonly storage: StorageService) {}

  /**
   * Store bytes as a public-marketplace-style IMAGE (JPEG/PNG/WebP) under `prefix`.
   * Used for photos: avatars, logos/banners, driver + vehicle + POD photos, listing
   * images, promotion assets.
   */
  async image(
    buffer: Buffer | undefined,
    prefix: string,
    visibility: Visibility,
    opts: { fileName?: string; fallbackName?: string; maxBytes?: number } = {},
  ): Promise<IngestResult> {
    const bytes = this.require(buffer, 'image');
    // Per-surface cap (avatars are smaller than marketplace images), never above
    // the middleware's hard ceiling.
    if (bytes.length > (opts.maxBytes ?? MAX_PRODUCT_IMAGE_BYTES)) {
      throw new BadRequestException('The image is too large.');
    }
    const mime = sniffProductImageMime(bytes);
    if (!mime) {
      throw new BadRequestException('Unsupported image type. Use JPEG, PNG, or WebP.');
    }
    return this.put(bytes, prefix, visibility, mime, productImageExt(mime), opts, 'image');
  }

  /**
   * Store bytes as a DOCUMENT (PDF/JPEG/PNG/WebP/HEIC) under `prefix`. Used for
   * role-application documents, résumés, listing documents and message attachments.
   */
  async document(
    buffer: Buffer | undefined,
    prefix: string,
    visibility: Visibility,
    opts: { fileName?: string; fallbackName?: string } = {},
  ): Promise<IngestResult> {
    const bytes = this.require(buffer, 'document');
    if (bytes.length > MAX_DOCUMENT_BYTES) {
      throw new BadRequestException('A document exceeds the maximum allowed size.');
    }
    const mime = sniffDocumentMime(bytes);
    if (!mime) {
      throw new BadRequestException('Unsupported document type. Use PDF, JPEG, PNG, WebP, or HEIC.');
    }
    return this.put(bytes, prefix, visibility, mime, documentExt(mime), opts, 'document');
  }

  /**
   * Store bytes as a RÉSUMÉ (PDF or DOCX only) under `prefix`. Kept separate from
   * {@link document} because the résumé allow-list accepts DOCX and rejects images.
   */
  async resume(
    buffer: Buffer | undefined,
    prefix: string,
    visibility: Visibility,
    opts: { fileName?: string } = {},
  ): Promise<IngestResult> {
    const bytes = this.require(buffer, 'document');
    if (bytes.length > MAX_RESUME_BYTES) {
      throw new BadRequestException('The file is too large.');
    }
    const mime = sniffResumeMime(bytes);
    if (!mime) {
      throw new BadRequestException('Upload a PDF or DOCX file.');
    }
    return this.put(bytes, prefix, visibility, mime, resumeExt(mime), opts, 'resume');
  }

  private require(buffer: Buffer | undefined, kind: string): Buffer {
    if (!buffer || buffer.length === 0) {
      throw new BadRequestException(
        `No ${kind} data was received. Please choose a file and try again.`,
      );
    }
    return buffer;
  }

  private async put(
    bytes: Buffer,
    prefix: string,
    visibility: Visibility,
    mime: string,
    ext: string,
    opts: { fileName?: string; fallbackName?: string },
    fallbackKind: string,
  ): Promise<IngestResult> {
    // Keep the uploader's filename in the key so admin/vendor review stays legible,
    // but force the extension to the SNIFFED type — a ".pdf" name on JPEG bytes must
    // not survive. buildKey sanitizes characters and adds a UUID segment, so two
    // uploads of the same filename never collide.
    const name = uploadBaseName(opts.fileName, opts.fallbackName ?? fallbackKind);
    const key = this.storage.buildKey(prefix, `${name}.${ext}`);
    await this.storage.putObject(key, bytes, mime, visibility);
    return { key, contentType: mime, sizeBytes: bytes.length };
  }
}
