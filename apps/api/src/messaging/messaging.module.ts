import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { MessagingService } from './messaging.service';
import { MessagingController } from './messaging.controller';
import { AdminMessagingController } from './admin-messaging.controller';

/**
 * Messaging & Order Communication (M17). Context-scoped conversations
 * (vendor-order / delivery / support), attachments, read state, support console,
 * and internal notes. Storage/Audit/Notifications come from @Global() modules.
 * MessagingService is exported so DispatchModule can post SYSTEM messages on
 * delivery events (best-effort).
 */
@Module({
  imports: [PrismaModule],
  controllers: [MessagingController, AdminMessagingController],
  providers: [MessagingService],
  exports: [MessagingService],
})
export class MessagingModule {}
