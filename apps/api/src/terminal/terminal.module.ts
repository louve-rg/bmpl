import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShippingModule } from '../shipping/shipping.module';
import { TerminalService } from './terminal.service';
import { AdminTerminalController, TerminalController, TerminalInviteController, TerminalLegsController } from './terminal.controller';

/**
 * Terminal operations (TERM-1/TERM-3/TERM-5): terminal companies, their
 * physical locations, staff scoped to a company AND a location, the invite
 * flow that creates that staff account, and (TERM-5) that staff submitting a
 * courier's handoff/pickup code at their own location. The custody/handoff
 * business logic itself still lives entirely in ShippingModule's
 * ShipmentService — this module imports it only to delegate to it after its
 * own location check, never to reimplement any of it. See TerminalService's
 * own doc comment.
 */
@Module({
  imports: [PrismaModule, ShippingModule],
  controllers: [AdminTerminalController, TerminalController, TerminalInviteController, TerminalLegsController],
  providers: [TerminalService],
  exports: [TerminalService],
})
export class TerminalModule {}
