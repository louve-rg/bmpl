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
import { EmailService } from '../email/email.service';
import { RedisService } from '../redis/redis.service';
import { SessionService, type IssuedSession } from './session.service';

const EMAIL_TOKEN_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1h

// RFC 2606 reserved TLD - guaranteed never to route to a real mailbox,
// whichever EMAIL_PROVIDER is live. Used only to pay the real send path's
// cost on a nonexistent account (see dummyEmailSendCost below); never a
// recipient a person could actually own.
const TIMING_GUARD_RECIPIENT = 'timing-guard@example.invalid';

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
    private readonly email: EmailService,
    private readonly redis: RedisService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Pays the real path's cost for a request against a nonexistent account,
   * so wall-clock time cannot distinguish "no such account" from "account
   * exists" (MDF-24). Same pattern as login()'s dummy verifyPassword call
   * against a fixed hash, extended to cover the email round trip too - the
   * dominant cost once EMAIL_PROVIDER is a real network provider.
   */
  private async dummyEmailSendCost(): Promise<void> {
    hashToken(generateToken());
    await this.email.send({ to: TIMING_GUARD_RECIPIENT, subject: 'noop', body: 'noop' });
  }

  /**
   * Per-ADDRESS (not per-IP) ceiling on password-reset/verification-resend
   * requests for one email, shared by both real and nonexistent addresses so
   * the limiter itself cannot be used to distinguish them (MDF-24 §4): an
   * attacker already knows how many times they've queried any given
   * address, real or not, so a uniform count->short-circuit shape leaks
   * nothing new. Checked and incremented BEFORE any account lookup.
   */
  private async underAddressNoticeLimit(route: string, email: string): Promise<boolean> {
    // Same test-environment gate as BmplThrottlerGuard (throttler.guard.ts) -
    // skipped by default so the deterministic suite isn't rate-limited by
    // Redis state left over between runs; a dedicated spec opts in exactly
    // as the existing per-IP throttle spec does.
    if (
      process.env.NODE_ENV === 'test' &&
      !(process.env.THROTTLE_TEST_ENABLED === 'true' || process.env.THROTTLE_TEST_ENABLED === '1')
    ) {
      return true;
    }
    const key = `email-notice-limit:${route}:${email}`;
    const count = await this.redis.client.incr(key);
    if (count === 1) await this.redis.client.expire(key, this.env.THROTTLE_TTL_SECONDS);
    return count <= this.env.EMAIL_NOTICE_ADDRESS_LIMIT;
  }

  /**
   * Register a new account. Every new user is created ACTIVE with an APPROVED
   * CUSTOMER role and a BZD wallet account, atomically. An email-verification
   * token is issued (verification gates business features, not basic login).
   */
  async register(input: RegisterInput, meta: RequestMeta): Promise<IssuedSession & { verificationEmailSent: boolean }> {
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
    // register() has no enumeration constraint - this is the caller's own
    // address, just typed in - so the real outcome is reported honestly
    // (MDF-24), unlike the two anonymous routes below.
    const verificationEmailSent = await this.notifications.sendEmail(
      { userId: user.id, type: 'ACCOUNT', title: tpl.title, body: tpl.body },
      user.email,
    );

    const issued = await this.sessions.create(
      { id: user.id, activeRoleCode: 'CUSTOMER' },
      meta,
    );
    return { ...issued, verificationEmailSent };
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
    // Checked BEFORE the lookup and shared across real/nonexistent addresses
    // alike — see underAddressNoticeLimit's own comment (MDF-24 §4).
    if (!(await this.underAddressNoticeLimit('resend-verification', email))) return;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Pay the real path's cost so wall-clock time doesn't disclose that
      // this address has no account (MDF-24).
      await this.dummyEmailSendCost();
      return;
    }
    if (user.emailVerifiedAt) return; // silent — no enumeration, no send needed either way
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
    // Checked BEFORE the lookup and shared across real/nonexistent addresses
    // alike — see underAddressNoticeLimit's own comment (MDF-24 §4).
    if (!(await this.underAddressNoticeLimit('forgot-password', email))) return;
    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) {
      // Pay the real path's cost so wall-clock time doesn't disclose that
      // this address has no account (MDF-24).
      await this.dummyEmailSendCost();
      return;
    }
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
