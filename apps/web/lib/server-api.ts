import { cookies } from 'next/headers';

/**
 * Server-component API helper. Forwards the incoming auth cookies to the API so
 * server-rendered dashboard pages can read the signed-in user. Returns null on
 * 401 so pages can redirect to /login.
 */
/**
 * Normalize the API base to a valid absolute URL (see next.config.mjs
 * apiBase). Refuses to guess when the env var is absent rather than
 * defaulting to the production API — the same hazard as the rewrite proxy,
 * independently reachable here since server components call fetch directly
 * rather than through the rewrite (BMPL-227, same defect and fix as admin's
 * BMPL-224).
 */
export function apiBase(raw?: string): string {
  if (!raw) {
    throw new Error(
      'NEXT_PUBLIC_API_URL is not set. Refusing to default to the production API — ' +
        'set it explicitly, e.g. NEXT_PUBLIC_API_URL=http://localhost:4000 for local development.',
    );
  }
  const v = raw.trim();
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api$/i, '');
}

const API_URL = apiBase(process.env.NEXT_PUBLIC_API_URL);

export async function serverGet<T>(path: string): Promise<T | null> {
  const cookieHeader = cookies().toString();
  const res = await fetch(`${API_URL}/api${path}`, {
    headers: { cookie: cookieHeader },
    cache: 'no-store',
  });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`API ${path} failed: ${res.status}`);
  return (await res.json()) as T;
}

/**
 * Resilient GET for PUBLIC pages: never throws. Returns the parsed body on 2xx,
 * or `null` on any error (API down, 5xx, network) so the page can render a
 * proper empty/error state instead of a Next.js 500. Distinguish "not found"
 * (404) from "unavailable" (everything else) via the `notFound` flag.
 */
export async function serverGetSafe<T>(
  path: string,
): Promise<{ ok: true; data: T } | { ok: false; notFound: boolean }> {
  try {
    const res = await fetch(`${API_URL}/api${path}`, {
      headers: { cookie: cookies().toString() },
      cache: 'no-store',
    });
    if (res.ok) return { ok: true, data: (await res.json()) as T };
    return { ok: false, notFound: res.status === 404 };
  } catch {
    return { ok: false, notFound: false };
  }
}
