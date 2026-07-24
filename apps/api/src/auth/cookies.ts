import { randomBytes } from 'node:crypto';
import type { Response } from 'express';
import { cookiesSecure, type Env } from '../config/env';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';
export const CSRF_COOKIE = 'csrf_token';

// The API mounts every route under the global '/api' prefix, so the refresh
// endpoint is '/api/auth/refresh'. The refresh cookie path MUST include that
// prefix or a real browser will never send it back (a path is a prefix match).
export const REFRESH_COOKIE_PATH = '/api/auth';

function baseCookieOptions(env: Env) {
  return {
    secure: cookiesSecure(env),
    sameSite: env.COOKIE_SAMESITE,
    // Empty COOKIE_DOMAIN => host-only cookie (recommended behind a same-origin
    // proxy). A ".domain" value shares the cookie across subdomains.
    ...(env.COOKIE_DOMAIN ? { domain: env.COOKIE_DOMAIN } : {}),
  };
}

/**
 * HTTP-only auth cookies for the web/admin clients. The refresh cookie is scoped
 * to the refresh endpoint path to limit exposure.
 */
export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: { accessToken: string; refreshToken: string; accessTtlMs: number; refreshTtlMs: number },
): void {
  const base = baseCookieOptions(env);
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...base,
    httpOnly: true,
    path: '/',
    maxAge: tokens.accessTtlMs,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...base,
    httpOnly: true,
    path: REFRESH_COOKIE_PATH,
    maxAge: tokens.refreshTtlMs,
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  const base = baseCookieOptions(env);
  res.clearCookie(ACCESS_COOKIE, { ...base, httpOnly: true, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base, httpOnly: true, path: REFRESH_COOKIE_PATH });
  res.clearCookie(CSRF_COOKIE, { ...base, httpOnly: false, path: '/' });
}

/**
 * Issue a fresh double-submit CSRF token. The cookie is deliberately NOT
 * HttpOnly so the first-party frontend JS can read it and echo it in the
 * `x-csrf-token` header on state-changing requests. A cross-site attacker
 * cannot read it (SameSite + same-origin policy), so they cannot forge the header.
 */
export function issueCsrfCookie(res: Response, env: Env): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(CSRF_COOKIE, token, {
    ...baseCookieOptions(env),
    httpOnly: false,
    path: '/',
    maxAge: 12 * 60 * 60 * 1000, // 12h
  });
  return token;
}
