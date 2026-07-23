import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { verifyAccessToken } from '@bmpl/authentication';
import { hasAnyApprovedRole, hasEveryPermission } from '@bmpl/authorization';
import type { Permission, RoleCode } from '@bmpl/shared';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuthContextService } from './auth-context.service';
import {
  IS_PUBLIC_KEY,
  PERMISSIONS_KEY,
  ROLES_KEY,
} from '../common/decorators';

function extractToken(req: Request): string | null {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7);
  const cookies = (req as Request & { cookies?: Record<string, string> }).cookies;
  return cookies?.access_token ?? null;
}

/**
 * Verifies the access token, confirms the session is still live in the DB, and
 * attaches a freshly-loaded AuthContext. Public routes are bypassed.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
    private readonly authContext: AuthContextService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const req = context.switchToHttp().getRequest<Request & { auth?: unknown }>();
    const token = extractToken(req);
    if (!token) throw new UnauthorizedException('Authentication required.');

    let claims;
    try {
      claims = await verifyAccessToken(token, this.env.JWT_ACCESS_SECRET);
    } catch {
      throw new UnauthorizedException('Invalid or expired session.');
    }

    // Session must still exist and be unrevoked/unexpired — the token alone is
    // not enough (rule #8: sessions are revocable).
    const session = await this.prisma.session.findUnique({
      where: { id: claims.sid },
      select: { id: true, userId: true, revokedAt: true, expiresAt: true, client: true },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session is no longer valid.');
    }

    const auth = await this.authContext.build({
      userId: session.userId,
      sessionId: session.id,
      client: session.client,
    });
    if (!auth) throw new UnauthorizedException('Account not found.');
    if (auth.status !== 'ACTIVE') {
      throw new ForbiddenException('Account is suspended or deactivated.');
    }

    (req as Request & { auth?: unknown }).auth = auth;
    return true;
  }
}

/** Enforces @Roles(...) — caller must hold at least one as APPROVED. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<RoleCode[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException();
    if (!hasAnyApprovedRole(auth, required)) {
      throw new ForbiddenException('You do not have an approved role for this action.');
    }
    return true;
  }
}

/** Enforces @RequirePermission(...) — admin-capability axis, separate from roles. */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const req = context.switchToHttp().getRequest();
    const auth = req.auth;
    if (!auth) throw new UnauthorizedException();
    if (!hasEveryPermission(auth, required)) {
      throw new ForbiddenException('You lack the required administrative permission.');
    }
    return true;
  }
}
