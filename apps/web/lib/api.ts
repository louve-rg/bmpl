/**
 * Browser-side API client. All requests go through the same-origin `/api`
 * proxy (see next.config) so the HTTP-only auth cookies are sent automatically.
 * On a 401 it transparently attempts a refresh once.
 */
export interface ApiError {
  status: number;
  message: string;
  errors?: Array<{ path: string; message: string }>;
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      'x-bmpl-client': 'web',
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
    const err: ApiError = {
      status: res.status,
      message: data?.message ?? 'Request failed',
      errors: data?.errors,
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
};
