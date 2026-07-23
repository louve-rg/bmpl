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
      'x-bmpl-client': 'admin',
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
    throw { status: res.status, message: data?.message ?? 'Request failed', errors: data?.errors } as ApiError;
  }
  return data as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
};
