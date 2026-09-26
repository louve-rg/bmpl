export interface ApiError {
  status: number;
  message: string;
  errors?: Array<{ path: string; message: string }>;
  /** Raw server message, kept for logs/debugging when `message` is a friendly fallback. */
  detail?: string;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Every caller across the admin console reads only `err.message` (never
 * `.errors`, even though the field is right there) — so a validation failure
 * with a generic top-level message ("Validation failed") showed nothing about
 * which field was wrong. Same defect and same fix as apps/web/lib/api.ts
 * (BMPL-141/9cc2028): fold the per-field detail into the message once, here,
 * rather than hunting every call site (BMPL-224).
 */
function withFieldErrors(raw: string, errors: Array<{ path: string; message: string }> | undefined): string {
  if (!errors || errors.length === 0) return raw;
  return `${raw}: ${errors.map((e) => (e.path ? `${e.path} — ${e.message}` : e.message)).join('; ')}`;
}

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

async function csrfToken(): Promise<string | undefined> {
  let token = readCookie('csrf_token');
  if (!token) {
    await fetch('/api/auth/csrf', { credentials: 'include', cache: 'no-store' }).catch(() => {});
    token = readCookie('csrf_token');
  }
  return token;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const method = (init.method ?? 'GET').toUpperCase();
  const csrfHeader: Record<string, string> = {};
  if (MUTATING.has(method)) {
    const token = await csrfToken();
    if (token) csrfHeader['x-csrf-token'] = token;
  }

  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-bmpl-client': 'admin',
      ...csrfHeader,
      ...(init.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (res.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (refreshed.ok) return request<T>(path, init, false);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const raw = (data?.message as string) ?? 'Request failed';
    const err: ApiError = { status: res.status, message: withFieldErrors(raw, data?.errors), errors: data?.errors, detail: raw };
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
