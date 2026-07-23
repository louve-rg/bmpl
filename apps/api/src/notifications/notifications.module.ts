import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { DevMailboxService } from './dev-mailbox.service';

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [NotificationsService, DevMailboxService],
  exports: [NotificationsService, DevMailboxService],
})
export class NotificationsModule {}
