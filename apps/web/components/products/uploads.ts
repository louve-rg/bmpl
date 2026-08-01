import { api } from '../../lib/api';

/** Read intrinsic pixel dimensions of an image file (best-effort). */
export function readDims(file: File): Promise<{ width?: number; height?: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({});
    img.src = URL.createObjectURL(file);
  });
}

export interface UploadedFile {
  key: string;
  width?: number;
  height?: number;
}

/**
 * Runs the presign → PUT storage flow for a single file and returns the object
 * key plus measured dimensions. The caller then calls images/confirm or
 * images/:id/replace with the returned key.
 */
export async function presignAndPut(productId: string, file: File): Promise<UploadedFile> {
  const dims = await readDims(file);
  const presign = await api.post<{ uploadUrl: string; key: string }>(
    `/vendor/products/${productId}/images/presign`,
    { fileName: file.name, contentType: file.type, sizeBytes: file.size },
  );
  const put = await fetch(presign.uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': file.type },
    body: file,
  });
  if (!put.ok) {
    throw { status: put.status, message: 'Upload to storage failed (storage may be unconfigured).' };
  }
  return { key: presign.key, width: dims.width, height: dims.height };
}
