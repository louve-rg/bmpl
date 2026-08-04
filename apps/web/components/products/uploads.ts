import { api, type ApiError } from '../../lib/api';
import type { ProductImage } from './types';

/** Read intrinsic pixel dimensions of an image file (best-effort). */
export function readDims(file: Blob): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve({});
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
}

// The file is proxied browser → web `/api` → API, so we keep it comfortably under
// typical serverless request-body limits. Larger images are downscaled first so a
// big phone photo still uploads instead of failing.
const SOFT_LIMIT_BYTES = 3.5 * 1024 * 1024;
const HARD_LIMIT_BYTES = 4 * 1024 * 1024;
const MAX_EDGE = 2000; // px — plenty for storefront galleries

interface Prepared {
  blob: Blob;
  width?: number;
  height?: number;
}

/**
 * Prepare a file for upload: if it's larger than the soft limit, downscale it via
 * canvas (longest edge ≤ MAX_EDGE) and re-encode — preserving PNG/WebP, falling
 * back to JPEG only when a re-encoded PNG is still too big. Small files pass
 * through untouched. Never throws — returns the original file on any failure.
 */
async function prepareForUpload(file: File): Promise<Prepared> {
  const dims = await readDims(file);
  if (file.size <= SOFT_LIMIT_BYTES) return { blob: file, ...dims };
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
    const w = Math.max(1, Math.round(bitmap.width * scale));
    const h = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) return { blob: file, ...dims };
    ctx.drawImage(bitmap, 0, 0, w, h);
    bitmap.close?.();

    const toBlob = (type: string, quality?: number) =>
      new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, type, quality));

    const preferred = file.type === 'image/png' ? 'image/png' : file.type === 'image/webp' ? 'image/webp' : 'image/jpeg';
    let out = await toBlob(preferred, preferred === 'image/jpeg' ? 0.85 : undefined);
    // A re-encoded PNG can still be huge (photographic content) → fall back to JPEG.
    if ((!out || out.size > HARD_LIMIT_BYTES) && preferred !== 'image/jpeg') {
      out = await toBlob('image/jpeg', 0.85);
    }
    if (out && out.size < file.size) return { blob: out, width: w, height: h };
    return { blob: file, ...dims };
  } catch {
    return { blob: file, ...dims };
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const usp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') usp.set(k, String(v));
  const s = usp.toString();
  return s ? `?${s}` : '';
}

/**
 * Translate an upload failure into an accurate, actionable message for the vendor
 * (technical detail stays in the ApiError.detail / server logs).
 */
export function uploadErrorMessage(e: unknown): string {
  const err = e as ApiError;
  const status = err?.status ?? 0;
  const raw = (err?.detail ?? err?.message ?? '').toLowerCase();
  if (status === 401) return 'Your session expired. Please sign in again.';
  if (status === 413 || raw.includes('too large') || raw.includes('maximum allowed size')) {
    return 'The image is too large. Please choose an image under 4 MB.';
  }
  if (raw.includes('unsupported image type') || status === 415) {
    return 'This file type is not supported. Use a JPEG, PNG, or WebP image.';
  }
  if (status === 503 || raw.includes('storage is not configured')) {
    return 'Image uploads are temporarily unavailable. Please try again shortly.';
  }
  if (status === 0) return 'The image could not be uploaded. Please check your connection and try again.';
  return 'The image could not be uploaded. Please check the file and try again.';
}

/**
 * Upload a new product image through the API (browser → same-origin proxy → API →
 * storage). Returns the product's updated image list. `variantId` assigns the
 * image to a specific variant; omit it to add to the General (not assigned) pool.
 */
export async function uploadProductImage(
  productId: string,
  file: File,
  opts: { variantId?: string } = {},
): Promise<ProductImage[]> {
  const { blob, width, height } = await prepareForUpload(file);
  if (blob.size > HARD_LIMIT_BYTES) {
    throw { status: 413, message: 'The image is too large. Please choose an image under 4 MB.' } as ApiError;
  }
  const qs = query({ variantId: opts.variantId, width, height });
  return api.upload<ProductImage[]>(`/vendor/products/${productId}/images/upload${qs}`, blob);
}

/** Replace an existing image's file in place (preserves variant/order/primary/alt). */
export async function replaceProductImageFile(
  productId: string,
  imageId: string,
  file: File,
): Promise<ProductImage[]> {
  const { blob, width, height } = await prepareForUpload(file);
  if (blob.size > HARD_LIMIT_BYTES) {
    throw { status: 413, message: 'The image is too large. Please choose an image under 4 MB.' } as ApiError;
  }
  const qs = query({ width, height });
  return api.upload<ProductImage[]>(`/vendor/products/${productId}/images/${imageId}/replace-file${qs}`, blob);
}
