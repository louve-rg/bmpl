import { cookies } from 'next/headers';

/**
 * Server-component API helper. Forwards the incoming auth cookies to the API so
 * server-rendered dashboard pages can read the signed-in user. Returns null on
 * 401 so pages can redirect to /login.
 */
const API_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

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
