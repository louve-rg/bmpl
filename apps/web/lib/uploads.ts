import { api } from './api';

/**
 * POST a file's raw bytes to a server-side upload endpoint and return the storage key.
 *
 * Every upload on the platform goes through here. The bytes travel browser →
 * same-origin `/api` proxy → API → object storage, so the browser never makes a
 * cross-origin PUT to the storage endpoint. That PUT is what the old
 * presign-and-upload flow did, and because the R2 bucket has no CORS policy for the
 * custom domain the browser blocked it — surfacing as "Load failed" on Safari and
 * "Failed to fetch" on Chrome/Firefox.
 *
 * The original filename rides on the query string (the body is the file itself) and
 * is used only to keep the storage key legible; the API sniffs the real media type
 * from the bytes and forces the stored extension to match.
 */
export async function uploadFile(path: string, file: File): Promise<string> {
  const sep = path.includes('?') ? '&' : '?';
  const { key } = await api.upload<{ key: string }>(
    `${path}${sep}filename=${encodeURIComponent(file.name)}`,
    file,
  );
  return key;
}
