import { Body, Controller, Delete, Get, Param, Patch, Put, Query } from '@nestjs/common';
import { notificationPreferenceSchema, type NotificationPreferenceInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { NotificationsService } from './notifications.service';

/**
 * Notification center API (M16). Every route is scoped to the authenticated
 * caller — a user can only ever see or mutate their own notifications and
 * preferences.
 */
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthContext,
    @Query('category') category?: string,
    @Query('unread') unread?: string,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ) {
    return this.notifications.listForUser(user.userId, {
      category,
      unreadOnly: unread === 'true',
      cursor,
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Get('unread-count')
  async unreadCount(@CurrentUser() user: AuthContext) {
    return { count: await this.notifications.unreadCount(user.userId) };
  }

  @Get('preferences')
  preferences(@CurrentUser() user: AuthContext) {
    return this.notifications.getPreferences(user.userId);
  }

  @Put('preferences')
  setPreference(@CurrentUser() user: AuthContext, @Body(ZodBody(notificationPreferenceSchema)) body: NotificationPreferenceInput) {
    const { category, ...prefs } = body;
    return this.notifications.setPreference(user.userId, category, prefs);
  }

  @Patch('read-all')
  async markAllRead(@CurrentUser() user: AuthContext) {
    await this.notifications.markAllRead(user.userId);
    return { ok: true };
  }

  @Patch(':id/read')
  async markRead(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.notifications.markRead(user.userId, id);
    return { ok: true };
  }

  @Delete(':id')
  async remove(@CurrentUser() user: AuthContext, @Param('id') id: string) {
    await this.notifications.remove(user.userId, id);
    return { ok: true };
  }
}
