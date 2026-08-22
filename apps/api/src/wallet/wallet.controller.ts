import { Body, Controller, ForbiddenException, Get, Param, Post } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { walletTopUpSchema, type WalletTopUpInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Roles } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { WalletService } from './wallet.service';

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
}
