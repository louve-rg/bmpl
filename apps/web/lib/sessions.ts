import { api } from './api';

/**
 * ACCT-SESSIONS (#811): GET /me/sessions returns only LIVE sessions (never
 * revoked, not expired) -- `refreshTokenHash` is never part of this shape,
 * and `current` is true on exactly the one session that authenticated the
 * request itself (apps/api/src/users/users.controller.ts's own doc comment).
 */
export interface SessionRow {
  id: string;
  userAgent: string | null;
  ipAddress: string | null;
  client: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  current: boolean;
}

export interface SessionsView {
  sessions: SessionRow[];
}

export interface RevokeOthersResult {
  ok: true;
  revokedCount: number;
}

export const sessionsApi = {
  list: () => api.get<SessionsView>('/me/sessions'),
  /**
   * DELETE /me/sessions/:id 404s when the id doesn't exist OR belongs to
   * someone else -- deliberately indistinguishable, per the controller's own
   * doc comment -- and is idempotent on an already-revoked row. Revoking the
   * caller's own current session makes the server clear the auth cookies, so
   * the caller of this function is the one that has to decide what to do
   * next when `row.current` was true; this module doesn't redirect anything.
   */
  revoke: (id: string) => api.del<{ ok: true }>(`/me/sessions/${encodeURIComponent(id)}`),
  revokeOthers: () => api.post<RevokeOthersResult>('/me/sessions/revoke-others', {}),
};

/**
 * `client` is the coarse platform label the server itself recorded at login
 * time (apps/api/src/auth/auth.controller.ts: `'mobile'` for a mobile
 * client, otherwise the `X-BMPL-Client` header or `'web'`) -- not a device
 * name. Capitalizing it for display invents nothing; it is exactly what the
 * server already sent.
 */
export function describeClient(client: string): string {
  if (client === 'web') return 'Web';
  if (client === 'mobile') return 'Mobile app';
  return client;
}

/**
 * A best-effort browser/OS label read directly out of the session's own
 * User-Agent string -- plain substring checks against tokens that string
 * itself contains, never a guess at what the device actually is. Returns
 * null when nothing recognisable is found (or there is no User-Agent at
 * all), so the caller can show an honest fallback instead of raw UA text.
 */
export function describeUserAgent(userAgent: string | null): string | null {
  if (!userAgent) return null;

  let browser: string | null = null;
  if (/Edg\//.test(userAgent)) browser = 'Edge';
  else if (/Chrome\//.test(userAgent) && !/Chromium/.test(userAgent)) browser = 'Chrome';
  else if (/Firefox\//.test(userAgent)) browser = 'Firefox';
  else if (/Version\/.*Safari\//.test(userAgent)) browser = 'Safari';

  let os: string | null = null;
  if (/iPhone|iPad/.test(userAgent)) os = 'iOS';
  else if (/Android/.test(userAgent)) os = 'Android';
  else if (/Mac OS X/.test(userAgent)) os = 'Mac';
  else if (/Windows/.test(userAgent)) os = 'Windows';
  else if (/Linux/.test(userAgent)) os = 'Linux';

  if (browser && os) return `${browser} on ${os}`;
  return browser ?? os;
}

/** `new Date(iso).toLocaleString('en-BZ', ...)` -- same convention as wallet/[id]/page.tsx. */
export function formatSessionTime(iso: string): string {
  return new Date(iso).toLocaleString('en-BZ', { dateStyle: 'medium', timeStyle: 'short' });
}
