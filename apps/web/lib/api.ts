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
  /**
   * MDF-925: the 409 `deleteAccount` refuses with (ConflictException's body
   * carries `reasons: string[]` alongside `message` -- a plain-language
   * sentence per live responsibility the account still holds, e.g. an open
   * vendor order or a non-zero wallet balance). `message` alone collapses
   * all of them into one generic line, so this is captured separately,
   * the same way `errors[]` already is, rather than losing it.
   */
  reasons?: string[];
}

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Every caller across the app reads only `err.message` (never `.errors`,
 * even though the field is right there) — so a validation failure with a
 * generic top-level message ("Validation failed") showed a user nothing
 * about which field was wrong, or why, anywhere in the product. Folding the
 * per-field detail into the message itself fixes every one of those call
 * sites at once, rather than needing each to be found and updated to read
 * `.errors` separately.
 */
function withFieldErrors(raw: string, errors: Array<{ path: string; message: string }> | undefined): string {
  if (!errors || errors.length === 0) return raw;
  return `${raw}: ${errors.map((e) => (e.path ? `${e.path} — ${e.message}` : e.message)).join('; ')}`;
}

type SessionExpiredListener = () => void;
let sessionExpiredListener: SessionExpiredListener | null = null;

/**
 * SESSION-EXPIRY-MID-ACTION (god, 2026-11-16): the one place that notifies
 * the app a session has genuinely died -- registered once, from the root
 * layout, not per page, since the 401 this fires on can happen on any
 * authenticated action anywhere. Fired only AFTER the silent refresh below
 * (or in `uploadBinary`) has already been tried and failed, never on the
 * first 401 -- by then re-authentication has actually been attempted, not
 * just guessed at. The two existing hand-written 401 messages this app
 * already has (`uploadErrorMessage` in components/products/uploads.ts, the
 * dashboard/reviews page) are untouched and keep showing their own copy
 * alongside this -- this is one new, consistent path, not a replacement.
 */
export function onSessionExpired(listener: SessionExpiredListener | null) {
  sessionExpiredListener = listener;
}

/**
 * WEB-FALSE-SESSION-EXPIRED-BURST (2026-11-23): the deployed build was still
 * showing "Your session expired" to anonymous visitors -- not on a cold load
 * (the #855/#859 fix above holds for that), but after scrolling triggered a
 * second wave of nav-level components (cart, saved, me, recommendations) that
 * ALL fire their own auth-gated call at once. Every one of those 401s used to
 * open its own independent POST /api/auth/refresh -- six or seven in the same
 * instant on a single page, observed directly on the live site -- and
 * /auth/refresh carries `@StrictThrottle()` (10/60s per IP). The caller unlucky
 * enough to land past that limit got back a 429 `ThrottlerException`, not the
 * API's own 401 "No refresh token provided." -- so the exact-message check
 * below didn't recognize it, and the visitor was told their session had
 * expired when nothing had even been attempted on their behalf yet.
 *
 * Single-flight de-dupes the common case (one page load's burst becomes ONE
 * real refresh attempt, not N), and the 429 carve-out below covers what
 * de-duping can't: several page loads in the same minute each making their
 * own single refresh call can still add up past the limit. A throttled
 * response is not evidence of anything about the session -- showing the
 * banner on it would be guessing, not stating a confirmed fact, which is the
 * one thing this listener is supposed to never do.
 */
let refreshInFlight: Promise<{ ok: boolean; status: number; body: unknown }> | null = null;

function refreshSession(): Promise<{ ok: boolean; status: number; body: unknown }> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      const res = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
      const body = await res.json().catch(() => null);
      return { ok: res.ok, status: res.status, body };
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

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

async function requestWithResponse(path: string, init: RequestInit = {}, retry = true): Promise<{ data: unknown; res: Response }> {
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
    const refreshed = await refreshSession();
    if (refreshed.ok) return requestWithResponse(path, init, false);
    // Refresh itself failed, not just the original call. That is NOT the
    // same thing as a real expiry: a visitor with no refresh cookie at all
    // (never signed in) hits this exact branch too, since several nav-level
    // components call auth-gated endpoints unconditionally on every page
    // load regardless of login state (WEB-FALSE-SESSION-EXPIRED). The old
    // guard here only excluded `/auth/*` calls themselves, which left every
    // one of those background calls free to tell an anonymous visitor their
    // session expired when they never had one.
    //
    // auth.controller.ts's refresh endpoint already distinguishes the two
    // cases in its own response body: no cookie sent at all throws exactly
    // "No refresh token provided." (auth.controller.ts:117), while a real,
    // dead session throws a different message (session.service.ts:89/92,
    // e.g. "Session expired. Please sign in again."). Suppress the listener
    // for the former -- never widen this into a per-endpoint allowlist,
    // which would leave the next auth-gated nav call to re-create this bug.
    // Also suppress on a 429 (WEB-FALSE-SESSION-EXPIRED-BURST above): a
    // throttled refresh call was never actually attempted, so it proves
    // nothing about whether the session is real or dead either way.
    const refreshBody = refreshed.body as { message?: string } | null;
    const cannotConfirmExpiry = refreshed.status === 429 || refreshBody?.message === 'No refresh token provided.';
    if (!path.startsWith('/auth/') && !cannotConfirmExpiry) sessionExpiredListener?.();
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
        : withFieldErrors(raw, data?.errors),
      errors: data?.errors,
      detail: raw,
      reasons: data?.reasons,
    };
    throw err;
  }
  return { data, res };
}

async function request<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const { data } = await requestWithResponse(path, init, retry);
  return data as T;
}

/**
 * Like `api.get`, but also hands back the raw response headers -- for the
 * rare caller that needs something riding a header rather than the body
 * (TERM-QUEUE-OVERFLOW-UI: the terminal queue's completeness signal is a
 * header precisely so the response body never had to change shape).
 */
async function getWithHeaders<T>(path: string): Promise<{ data: T; headers: Headers }> {
  const { data, res } = await requestWithResponse(path, { method: 'GET' });
  return { data: data as T, headers: res.headers };
}

/**
 * Upload raw binary (an image File/Blob) to a mutating endpoint through the
 * same-origin `/api` proxy. Unlike `request`, it sends the file bytes as the body
 * with the file's own Content-Type (so the API's scoped raw parser receives them)
 * — never JSON. Carries the CSRF token + cookies and retries once after a refresh,
 * exactly like `request`. Metadata belongs in the `path` query string.
 */
async function uploadBinary<T>(path: string, body: Blob, retry = true): Promise<T> {
  const token = await csrfToken();
  const res = await fetch(`/api${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': body.type || 'application/octet-stream',
      'x-bmpl-client': 'web',
      ...(token ? { 'x-csrf-token': token } : {}),
    },
    body,
    credentials: 'include',
    cache: 'no-store',
  });

  if (res.status === 401 && retry) {
    const refreshed = await refreshSession();
    if (refreshed.ok) return uploadBinary<T>(path, body, false);
    // Same distinction as `requestWithResponse` above -- see its comment.
    const refreshBody = refreshed.body as { message?: string } | null;
    const cannotConfirmExpiry = refreshed.status === 429 || refreshBody?.message === 'No refresh token provided.';
    if (!cannotConfirmExpiry) sessionExpiredListener?.();
  }

  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) {
    const raw = (data?.message as string) ?? 'Upload failed';
    const err: ApiError = { status: res.status, message: withFieldErrors(raw, data?.errors), errors: data?.errors, detail: raw };
    throw err;
  }
  return data as T;
}

/**
 * MDF-559: `message` already folds `errors[]` in (see `withFieldErrors`
 * above, BMPL-141) — so every caller gets a real reason from `.message`
 * alone, never a bare "Validation failed". This is the one further step on
 * top of that: `errors[0].message` is the SAME reason again but without the
 * generic "Validation failed: " prefix still attached, so a caller that can
 * show a single clean line (most of them) should prefer it. `.message` is
 * still the right fallback for a business refusal — those carry no
 * `errors[]` at all, and are already the real reason on their own, not a
 * generic placeholder.
 */
export function errorMessage(e: unknown, fallback: string): string {
  const err = e as Partial<ApiError> | null | undefined;
  return err?.errors?.[0]?.message ?? err?.message ?? fallback;
}

export const api = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  getWithHeaders: <T>(path: string) => getWithHeaders<T>(path),
  upload: <T>(path: string, body: Blob) => uploadBinary<T>(path, body),
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  del: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'DELETE', body: body ? JSON.stringify(body) : undefined }),
};
