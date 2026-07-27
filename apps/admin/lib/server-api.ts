import { cookies } from 'next/headers';

/** Normalize the API base to a valid absolute URL (see next.config.mjs apiBase). */
function apiBase(raw?: string): string {
  const v = (raw ?? 'https://bmplapi-production.up.railway.app').trim();
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api$/i, '');
}

const API_URL = apiBase(process.env.ADMIN_PUBLIC_API_URL);

/**
 * Server-side admin fetch. Returns { ok:false } on 401/403 so pages can bounce
 * to the login screen without throwing — the API enforces the real permission
 * checks on every call.
 */
export async function serverGet<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; status: number }> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie: cookies().toString() },
    cache: 'no-store',
  });
  if (res.status === 401 || res.status === 403) return { ok: false, status: res.status };
  if (!res.ok) throw new Error(`Admin API ${path} failed: ${res.status}`);
  return { ok: true, data: (await res.json()) as T };
}
