import type { Response } from 'express';
import type { Env } from '../config/env';

export const ACCESS_COOKIE = 'access_token';
export const REFRESH_COOKIE = 'refresh_token';

/**
 * HTTP-only, Secure, SameSite=Strict cookies for the web/admin clients. The
 * refresh cookie is scoped to the refresh endpoint path to limit exposure.
 */
export function setAuthCookies(
  res: Response,
  env: Env,
  tokens: { accessToken: string; refreshToken: string; accessTtlMs: number; refreshTtlMs: number },
): void {
  const secure = env.NODE_ENV === 'production';
  const common = {
    httpOnly: true,
    secure,
    sameSite: 'strict' as const,
    domain: env.COOKIE_DOMAIN,
    path: '/',
  };
  res.cookie(ACCESS_COOKIE, tokens.accessToken, {
    ...common,
    maxAge: tokens.accessTtlMs,
  });
  res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
    ...common,
    path: '/auth',
    maxAge: tokens.refreshTtlMs,
  });
}

export function clearAuthCookies(res: Response, env: Env): void {
  const common = { httpOnly: true, domain: env.COOKIE_DOMAIN };
  res.clearCookie(ACCESS_COOKIE, { ...common, path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...common, path: '/auth' });
}
