/**
 * Browser-side API client. All requests go through the same-origin `/api`
 * proxy (see next.config) so the HTTP-only auth cookies are sent automatically.
 * On a 401 it transparently attempts a refresh once. State-changing requests
 * carry the double-submit CSRF token (read from the non-HttpOnly csrf cookie).
 */
export interface ApiError {
  status: number;
  message: string;
  errors?: Array<{ path: string; message: string }>;
  /** Raw server message, kept for logs/debugging when `message` is a friendly fallback. */
  detail?: string;
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function readCookie(name: string): string | undefined {
  if (typeof document === 'undefined') return undefined;
  const m = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]+)`));
  return m?.[1] ? decodeURIComponent(m[1]) : undefined;
}

async function csrfToken(): Promise<string | undefined> {
  let token = readCookie('csrf_token');
  if (!token) {
    // Obtain a token (sets the cookie) before the first mutation.
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
      'x-bmpl-client': 'web',
      ...csrfHeader,
      ...(init.headers ?? {}),
    },
    credentials: 'include',
    cache: 'no-store',
  });

  if (res.status === 401 && retry && path !== '/auth/refresh') {
    const refreshed = await fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'include',
    });
    if (refreshed.ok) return request<T>(path, init, false);
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;

  if (!res.ok) {
    const raw = (data?.message as string) ?? 'Request failed';
    // A 403 from the origin/CSRF guard is an infrastructure/session issue, not
    // something the shopper did. Show an actionable message; keep the raw detail
    // (still logged to the console) so debugging is never hidden.
    const isOriginOrCsrf = res.status === 403 && /origin is not allowed|csrf/i.test(raw);
    if (isOriginOrCsrf && typeof console !== 'undefined') {
      console.warn(`[api] ${method} ${path} blocked: ${raw}`);
    }
    const err: ApiError = {
      status: res.status,
      message: isOriginOrCsrf
        ? 'We couldn’t complete that request. Please refresh the page and try again.'
        : raw,
      errors: data?.errors,
      detail: raw,
    };
    throw err;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
