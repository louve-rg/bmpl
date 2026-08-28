import { Body, Controller, ForbiddenException, Get, Inject, NotFoundException, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { walletTopUpSchema, type WalletTopUpInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from './wallet.service';

/**
 * The hard ceiling on self-issued UAT credit, per person, cumulative.
 *
 * A constant rather than a setting: the environment can lower the per-click
 * amount but nothing outside this file can raise the total anybody may mint for
 * themselves. Spending does not restore headroom.
 */
const SELF_SERVICE_CAP_MINOR = 25_000; // BZ$250.00

/**
 * The customer's own wallet.
 *
 * Reads are self-scoped. The one write — funding — is deliberately narrow: see
 * the note on `topUp` below for why it exists and what stops it being a way to
 * mint money.
 */
@Roles('CUSTOMER')
@Controller('wallet')
export class WalletController {
  constructor(
    private readonly wallet: WalletService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /** Available, on hold, and the two together. */
  @Get()
  summary(@CurrentUser() user: AuthContext) {
    return this.wallet.summary(user.userId);
  }

  @Get('transactions')
  transactions(@CurrentUser() user: AuthContext) {
    return this.wallet.listForUser(user.userId);
  }

  @Get('transactions/:id')
  transaction(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    return this.wallet.getForUser(user.userId, id);
  }

  /**
   * Put money into a SIMULATION wallet.
   *
   * BML has no external payment rail configured — no card processor, no bank
   * transfer, nothing that could move a real Belize dollar. So there is exactly
   * one honest way to exercise the wallet engine end to end, and this is it:
   * funding that is real bookkeeping over money that does not represent
   * anything.
   *
   * Three things keep it from being a hole:
   *
   *   1. It is gated on `user.isTest`, which is ADMIN-SET ONLY. A customer
   *      cannot set it on themselves, so they cannot reach this at all. An
   *      ordinary customer gets a 403 that says so plainly.
   *   2. The money is posted through the SAME ledger as everything else — a
   *      balanced TOPUP, customer credited, clearing account debited. Nothing
   *      here writes a balance directly.
   *   3. The transaction is marked `isTest`, so real reporting and settlement
   *      exclude it while the ledger still balances.
   *
   * When a real funding rail is eventually configured, it posts the same TOPUP
   * against the same clearing account, and this endpoint stops being the only
   * way in rather than needing to be unpicked.
   */
  @StrictThrottle()
  @Post('top-up')
  async topUp(@CurrentUser() user: AuthContext, @Body(ZodBody(walletTopUpSchema)) dto: WalletTopUpInput) {
    const me = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { isTest: true } });
    if (!me?.isTest) {
      // Said plainly rather than as a generic forbidden: a real customer asking
      // to add money is asking a reasonable question, and deserves a real answer.
      throw new ForbiddenException(
        'Adding money to your wallet is not available yet. BML does not have a card or bank payment method connected.',
      );
    }

    await this.audit.record({
      action: 'WALLET_TEST_FUNDING_GRANTED',
      actorId: user.userId,
      targetUserId: user.userId,
      newValue: { amountMinor: dto.amountMinor, currency: 'BZD' },
    });
    return this.wallet.topUp(user.userId, BigInt(dto.amountMinor), 'BZD', {
      // A fresh reference per request: the ledger's unique constraint then makes
      // an accidental double-submit collide rather than fund twice.
      reference: `test-topup:${user.userId}:${randomUUID()}`,
      description: 'Simulation funds added for testing',
      actorId: user.userId,
    });
  }

  // ==========================================================================
  // TEMPORARY UAT FEATURE — MUST BE DISABLED BEFORE COMMERCIAL LAUNCH.
  //
  // Disable by clearing ENABLE_SELF_SERVICE_TEST_FUNDING (or setting it to
  // "false") and redeploying. The flag defaults to OFF and is not derived from
  // NODE_ENV, so an environment that simply does not set it has the feature
  // off — no code has to be remembered and removed for that to be true.
  // ==========================================================================

  /**
   * Whether this person can still issue themselves test funds, and for how
   * much. Drives the wallet page: a button nobody can use, with no explanation,
   * is worse than no button.
   */
  @Get('test-funding')
  async testFundingStatus(@CurrentUser() user: AuthContext) {
    const available = this.selfServiceAvailable();
    if (!available.enabled) return { enabled: false as const };
    const granted = await this.wallet.selfServiceGrantedMinor(user.userId);
    const cap = BigInt(SELF_SERVICE_CAP_MINOR);
    return {
      enabled: true as const,
      amountMinor: Math.min(this.env.SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR, SELF_SERVICE_CAP_MINOR),
      capMinor: SELF_SERVICE_CAP_MINOR,
      grantedMinor: Number(granted),
      remainingMinor: Number(cap > granted ? cap - granted : 0n),
      claimed: granted >= cap,
    };
  }

  /**
   * Issue simulation funds to YOUR OWN wallet.
   *
   * Takes no body at all, deliberately. There is no recipient to redirect, no
   * amount to inflate and no wallet id to substitute: the person comes from the
   * session and the amount from server configuration, capped in the environment
   * schema itself. Anything a client sends is ignored because nothing is read.
   *
   * Sits behind the same session, role and CSRF protection as every other
   * wallet mutation. Test money is still money moving through the ledger, and
   * exempting it because "it is only simulated" is how a simulated hole becomes
   * a real one.
   */
  @StrictThrottle()
  @Post('test-fund')
  async selfFund(@CurrentUser() user: AuthContext) {
    const available = this.selfServiceAvailable();
    if (!available.enabled) {
      throw new NotFoundException('Not found.');
    }
    const amount = BigInt(Math.min(this.env.SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR, SELF_SERVICE_CAP_MINOR));
    return this.wallet.selfServiceTestCredit(user.userId, amount, BigInt(SELF_SERVICE_CAP_MINOR));
  }

  /**
   * The kill switch, plus an optional self-disarming expiry.
   *
   * Both are evaluated per request rather than cached at boot, so turning the
   * flag off takes effect on the next call rather than the next restart.
   */
  private selfServiceAvailable(): { enabled: boolean } {
    if (!this.env.ENABLE_SELF_SERVICE_TEST_FUNDING) return { enabled: false };
    const expiry = this.env.SELF_SERVICE_TEST_FUNDING_EXPIRES_AT;
    if (expiry && Date.now() > Date.parse(expiry)) return { enabled: false };
    return { enabled: true };
  }
}
