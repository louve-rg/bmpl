import { Controller, Get, Param, Patch, Query } from '@nestjs/common';
import { CurrentUser } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { NotificationsService } from './notifications.service';

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@CurrentUser() user: AuthContext, @Query('unread') unread?: string) {
    return this.notifications.listForUser(user.userId, unread === 'true');
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.notifications.markRead(user.userId, id);
    return { ok: true };
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthContext) {
    await this.notifications.markAllRead(user.userId);
    return { ok: true };
  }
}
