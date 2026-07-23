import { cookies } from 'next/headers';

const API_URL = process.env.ADMIN_PUBLIC_API_URL ?? 'http://localhost:4000';

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
