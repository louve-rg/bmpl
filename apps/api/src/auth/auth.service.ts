import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import {
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from '@bmpl/authentication';
import { templates } from '@bmpl/notifications';
import type { RegisterInput, ResetPasswordInput } from '@bmpl/validation';
import { PrismaService } from '../prisma/prisma.service';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { SessionService, type IssuedSession } from './session.service';

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

interface RequestMeta {
  client: string;
  userAgent?: string;
  ipAddress?: string;
}

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sessions: SessionService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Register a new account. Every new user is created ACTIVE with an APPROVED
   * CUSTOMER role and a BZD wallet account, atomically. An email-verification
   * token is issued (verification gates business features, not basic login).
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession> {
    const existing = await this.prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      // Do not disclose which emails are registered.
      throw new BadRequestException('Unable to register with those details.');
    }

    const passwordHash = await hashPassword(input.password);
    const emailToken = generateToken();

    const user = await this.prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone ?? null,
          district: input.district ?? null,
          acceptedTermsAt: new Date(),
          activeRoleCode: 'CUSTOMER',
          roles: {
            create: { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() },
          },
          walletAccounts: { create: { type: 'USER', currency: 'BZD' } },
          emailTokens: {
            create: {
              tokenHash: hashToken(emailToken),
              expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
            },
          },
        },
      });

      await this.audit.record(
        {
          action: 'USER_REGISTERED',
          actorId: created.id,
          targetUserId: created.id,
          ipAddress: meta.ipAddress,
        },
        tx,
      );
      return created;
    });

    const link = `${this.env.NEXT_PUBLIC_SITE_URL}/verify-email?token=${emailToken}`;
    const tpl = templates.emailVerification(link);
    await this.notifications.sendEmail(
      { userId: user.id, type: 'ACCOUNT', title: tpl.title, body: tpl.body },
      user.email,
    );

    return this.sessions.create(
      { id: user.id, activeRoleCode: 'CUSTOMER' },
      meta,
    );
  }

  async login(
    input: { email: string; password: string },
    meta: RequestMeta,
  ): Promise<IssuedSession> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });
    // Constant-ish work whether or not the user exists.
    const ok = user
      ? await verifyPassword(user.passwordHash, input.password)
      : await verifyPassword(
          '$argon2id$v=19$m=19456,t=2,p=1$c29tZXNhbHRzb21lc2FsdA$3Q0Xb8m2m0Q3m0Q3m0Q3mA',
          input.password,
        );

    if (!user || !ok) {
      throw new UnauthorizedException('Invalid email or password.');
    }
    if (user.status !== 'ACTIVE') {
      throw new UnauthorizedException('Your account is suspended. Contact support.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });
    await this.audit.record({
      action: 'USER_LOGGED_IN',
      actorId: user.id,
      targetUserId: user.id,
      ipAddress: meta.ipAddress,
    });

    return this.sessions.create({ id: user.id, activeRoleCode: user.activeRoleCode }, meta);
  }

  async logout(sessionId: string): Promise<void> {
    await this.sessions.revoke(sessionId);
  }

  async verifyEmail(token: string): Promise<void> {
    const record = await this.prisma.emailVerificationToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This verification link is invalid or has expired.');
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.emailVerificationToken.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      });
      await tx.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      });
      await this.audit.record(
        { action: 'EMAIL_VERIFIED', actorId: record.userId, targetUserId: record.userId },
        tx,
      );
    });
  }

  async resendVerification(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user || user.emailVerifiedAt) return; // silent — no enumeration
    const token = generateToken();
    await this.prisma.emailVerificationToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + EMAIL_TOKEN_TTL_MS),
      },
    });
    const link = `${this.env.NEXT_PUBLIC_SITE_URL}/verify-email?token=${token}`;
    const tpl = templates.emailVerification(link);
    await this.notifications.sendEmail(
      { userId: user.id, type: 'ACCOUNT', title: tpl.title, body: tpl.body },
      user.email,
    );
  }

  /** Always returns success to prevent account enumeration. */
  async forgotPassword(email: string): Promise<void> {
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return;
    const token = generateToken();
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });
    const link = `${this.env.NEXT_PUBLIC_SITE_URL}/reset-password?token=${token}`;
    const tpl = templates.passwordReset(link);
    await this.notifications.sendEmail(
      { userId: user.id, type: 'SECURITY', title: tpl.title, body: tpl.body },
      user.email,
    );
  }

  async resetPassword(input: ResetPasswordInput, meta: RequestMeta): Promise<void> {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(input.token) },
    });
    if (!record || record.consumedAt || record.expiresAt < new Date()) {
      throw new BadRequestException('This reset link is invalid or has expired.');
    }
    const passwordHash = await hashPassword(input.password);
    await this.prisma.$transaction(async (tx) => {
      // Consume conditionally, not unconditionally. The check above is a read
      // taken before this transaction opened, so on its own it cannot promise
      // single use: two requests carrying the same token can both observe
      // `consumedAt: null` and both proceed, and the later one silently decides
      // the account's password. Making the claim itself the write — update only
      // the row that is still unconsumed, and require that it matched — means
      // exactly one racing request can win.
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: record.id, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count !== 1) {
        throw new BadRequestException('This reset link is invalid or has expired.');
      }
      await tx.user.update({
        where: { id: record.userId },
        data: { passwordHash },
      });
      await this.audit.record(
        {
          action: 'PASSWORD_RESET',
          actorId: record.userId,
          targetUserId: record.userId,
          ipAddress: meta.ipAddress,
        },
        tx,
      );
    });
    // Revoke every existing session — a password reset invalidates all sessions.
    await this.sessions.revokeAllForUser(record.userId);
  }
}
