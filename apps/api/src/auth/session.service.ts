import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import {
  hashToken,
  issueToken,
  parseTtlMs,
  signAccessToken,
} from '@bmpl/authentication';
import type { RoleCode } from '@bmpl/shared';
import { PrismaService } from '../prisma/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface IssuedSession {
  sessionId: string;
  accessToken: string;
  refreshToken: string; // raw — returned to client once
  accessTtlMs: number;
  refreshTtlMs: number;
}

interface SessionUser {
  id: string;
  activeRoleCode: RoleCode | null;
}

/**
 * Owns the server-side session lifecycle. Refresh tokens are opaque; only their
 * hash is stored, and they ROTATE on every use (theft of an old refresh token
 * is detectable and useless after one rotation).
 */
@Injectable()
export class SessionService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  private async signAccess(
    user: SessionUser,
    sessionId: string,
    client: string,
  ): Promise<string> {
    return signAccessToken(
      { sub: user.id, sid: sessionId, activeRole: user.activeRoleCode, client },
      this.env.JWT_ACCESS_SECRET,
      this.env.JWT_ACCESS_TTL,
    );
  }

  async create(
    user: SessionUser,
    context: { client: string; userAgent?: string; ipAddress?: string },
  ): Promise<IssuedSession> {
    const refreshTtlMs = parseTtlMs(this.env.JWT_REFRESH_TTL);
    const accessTtlMs = parseTtlMs(this.env.JWT_ACCESS_TTL);
    const refresh = issueToken(refreshTtlMs);

    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        refreshTokenHash: refresh.hash,
        userAgent: context.userAgent ?? null,
        ipAddress: context.ipAddress ?? null,
        client: context.client,
        expiresAt: refresh.expiresAt,
      },
    });

    const accessToken = await this.signAccess(user, session.id, context.client);
    return {
      sessionId: session.id,
      accessToken,
      refreshToken: refresh.raw,
      accessTtlMs,
      refreshTtlMs,
    };
  }

  /** Validate + rotate a refresh token, returning fresh access/refresh tokens. */
  async rotate(rawRefresh: string): Promise<IssuedSession> {
    const hash = hashToken(rawRefresh);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: { user: { select: { id: true, activeRoleCode: true, status: true } } },
    });
    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Session expired. Please sign in again.');
    }
    if (session.user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Account is not active.');
    }

    const refreshTtlMs = parseTtlMs(this.env.JWT_REFRESH_TTL);
    const accessTtlMs = parseTtlMs(this.env.JWT_ACCESS_TTL);
    const next = issueToken(refreshTtlMs);

    await this.prisma.session.update({
      where: { id: session.id },
      data: {
        refreshTokenHash: next.hash,
        expiresAt: next.expiresAt,
        lastUsedAt: new Date(),
      },
    });

    const accessToken = await this.signAccess(session.user, session.id, session.client);
    return {
      sessionId: session.id,
      accessToken,
      refreshToken: next.raw,
      accessTtlMs,
      refreshTtlMs,
    };
  }

  async revoke(sessionId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { id: sessionId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}
