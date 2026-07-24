import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { ENV } from '../config/config.module';
import { corsOrigins, type Env } from '../config/env';
import { IS_PUBLIC_KEY } from '../common/decorators';
import { CSRF_COOKIE } from './cookies';

/** Opt a specific route out of CSRF checks (rarely needed). */
export const SKIP_CSRF_KEY = 'skipCsrf';
export const SkipCsrf = () => SetMetadata(SKIP_CSRF_KEY, true);

const MUTATING = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requestOrigin(req: Request): string | null {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin) return origin;
  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer) {
    try {
      return new URL(referer).origin;
    } catch {
      return null;
    }
  }
  return null;
}

/**
 * CSRF protection tailored to this app's transport:
 *  - Native mobile authenticates with `Authorization: Bearer` (secure-store
 *    tokens) — NOT cookies — so it is exempt from browser CSRF entirely.
 *  - Browser (web/admin) uses cookies. For state-changing requests we require
 *    BOTH (1) a browser Origin/Referer within the allow-list and (2) a
 *    double-submit token: `x-csrf-token` header must equal the `csrf_token`
 *    cookie (which a cross-site attacker cannot read).
 *  - Non-browser callers (no Origin/Referer, e.g. server-to-server, curl) are
 *    not subject to browser CSRF; they are protected by auth + SameSite cookies.
 *  Public (unauthenticated) routes are skipped — there is no session to abuse,
 *  and SameSite=Strict + the Origin check still apply to real browsers.
 */
@Injectable()
export class CsrfGuard implements CanActivate {
  private readonly allowed: Set<string>;

  constructor(
    private readonly reflector: Reflector,
    @Inject(ENV) private readonly env: Env,
  ) {
    this.allowed = new Set(corsOrigins(env));
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.env.CSRF_ENABLED) return true;

    const req = context.switchToHttp().getRequest<Request>();
    if (!MUTATING.has(req.method)) return true;

    const skip = this.reflector.getAllAndOverride<boolean>(SKIP_CSRF_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (skip) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    // Mobile / API clients using bearer tokens are not cookie-driven → exempt.
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && authHeader.startsWith('Bearer ')) return true;

    const origin = requestOrigin(req);
    // No browser origin at all → treat as non-browser client (allowed).
    if (!origin) return true;

    if (!this.allowed.has(origin)) {
      throw new ForbiddenException('Request origin is not allowed.');
    }

    const headerToken = req.headers['x-csrf-token'];
    const cookieToken = (req as Request & { cookies?: Record<string, string> }).cookies?.[
      CSRF_COOKIE
    ];
    if (
      typeof headerToken !== 'string' ||
      !headerToken ||
      !cookieToken ||
      !timingSafeEqual(headerToken, cookieToken)
    ) {
      throw new ForbiddenException('Invalid or missing CSRF token.');
    }
    return true;
  }
}
