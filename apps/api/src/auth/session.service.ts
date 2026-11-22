import { Inject, Injectable, NotFoundException, UnauthorizedException } from '@nestjs/common';
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

  /**
   * Revoke by raw session id, no ownership check at all. Safe TODAY only
   * because every existing caller already holds an id it owns outright —
   * `logout`/`changePassword` pass the JWT's own `sid` claim (the request's
   * own session), `revokeAllForUser` below takes a userId directly instead
   * of an id. NEVER call this with an id that came from a path/body
   * parameter of an authenticated request — that is exactly the hazard
   * {@link revokeOwn} exists to close. See ACCT-SESSIONS.
   */
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

  /**
   * This user's own LIVE sessions — never revoked, not yet expired. A
   * revoked or expired row is nothing the caller can act on, so it is left
   * out rather than shown as inert clutter the list screen would otherwise
   * have to explain. Never selects `refreshTokenHash` — there is no reason
   * for that value, or anything derived from it, to leave this service.
   */
  async listForUser(userId: string) {
    return this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        client: true,
        createdAt: true,
        lastUsedAt: true,
        expiresAt: true,
      },
      orderBy: { lastUsedAt: 'desc' },
    });
  }

  /**
   * ACCT-SESSIONS: revoke exactly one of THIS user's own sessions, for use
   * directly behind an authenticated route taking a session id as a path
   * parameter. Ownership is enforced INSIDE this method's own query — `id`
   * AND `userId` in the same `where` — rather than left to a guard above
   * it, because the guard only proves the caller is signed in as someone,
   * never that the id they supplied is their own, and the next person
   * calling this method will not re-read this comment. Chosen over adding
   * `userId` to the existing `revoke(sessionId)` above: that method is
   * called internally with ids already known-owned by construction (the
   * caller's own `sid` claim), and giving it a parameter none of its
   * current callers have would invite one to pass the wrong thing; a
   * second, purpose-built method for the one caller that genuinely takes
   * an id from the outside keeps the hazard scoped to where it actually is.
   *
   * 404s a session that does not exist OR belongs to someone else — the
   * same "indistinguishable from not found" reasoning as
   * `AddressesService.ownedOrThrow`, so a caller fishing for other users'
   * session ids learns nothing by probing. Idempotent on an already-revoked
   * or already-expired session (a stale list the browser still has open
   * must not turn into an error) — the `updateMany` only ever touches a
   * still-live row, and does nothing, successfully, otherwise.
   */
  async revokeOwn(userId: string, sessionId: string): Promise<void> {
    const owned = await this.prisma.session.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
    if (!owned) throw new NotFoundException('Session not found.');
    await this.prisma.session.updateMany({
      where: { id: sessionId, userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /**
   * "Sign out everywhere else": revoke every OTHER live session for this
   * user, deliberately leaving `exceptSessionId` (the caller's own current
   * session, making this very call) untouched — the whole point of the
   * action is that the browser calling it stays signed in.
   */
  async revokeOthersForUser(userId: string, exceptSessionId: string): Promise<{ revokedCount: number }> {
    const result = await this.prisma.session.updateMany({
      where: { userId, revokedAt: null, id: { not: exceptSessionId } },
      data: { revokedAt: new Date() },
    });
    return { revokedCount: result.count };
  }
}
