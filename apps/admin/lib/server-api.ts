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
): Promise<{ ok: true; data: T } | { ok: false; status: number; message?: string }> {
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie: cookies().toString() },
    cache: 'no-store',
  });
  // 401/403/404 are answers, not failures: pages tell refused from missing
  // (BMPL-144) instead of a 403 masquerading as "not found" or a 404
  // crashing the page. The server's own sentence rides along so the screen
  // can say why in the API's words, the same way the client pages do.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    let message: string | undefined;
    try {
      message = ((await res.json()) as { message?: string }).message;
    } catch {
      /* body absent or not JSON — the status alone still tells the story */
    }
    return { ok: false, status: res.status, message };
  }
  if (!res.ok) throw new Error(`Admin API ${path} failed: ${res.status}`);
  return { ok: true, data: (await res.json()) as T };
}
