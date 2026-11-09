import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TerminalService } from './terminal.service';
import { AdminTerminalController, TerminalController, TerminalInviteController } from './terminal.controller';

/**
 * Terminal operations (TERM-1/TERM-3) — backend half of slice 1: terminal
 * companies, their physical locations, staff scoped to a company AND a
 * location, and the invite flow that creates that staff account. No custody
 * or handoff logic lives here; see TerminalService's own doc comment.
 */
@Module({
  imports: [PrismaModule],
  controllers: [AdminTerminalController, TerminalController, TerminalInviteController],
  providers: [TerminalService],
  exports: [TerminalService],
})
export class TerminalModule {}
