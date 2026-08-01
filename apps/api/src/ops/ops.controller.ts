import { Body, Controller, Get, Header, Patch, Query } from '@nestjs/common';
import { updatePlatformSettingsSchema, type UpdatePlatformSettingsInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, Public, RequirePermission } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { OpsService } from './ops.service';

/**
 * Platform operations console (M23). Aggregated action queues + audit export
 * (`ops.read`), and the announcement/maintenance banner (`ops.manage` to edit,
 * `audit.read` to export the audit log).
 */
@Controller('admin/ops')
export class AdminOpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('overview')
  @RequirePermission('ops.read')
  overview() {
    return this.ops.overview();
  }

  @Get('settings')
  @RequirePermission('ops.read')
  settings() {
    return this.ops.getSettings();
  }

  @Patch('settings')
  @RequirePermission('ops.manage')
  updateSettings(@CurrentUser() u: AuthContext, @Body(ZodBody(updatePlatformSettingsSchema)) b: UpdatePlatformSettingsInput) {
    return this.ops.updateSettings({ userId: u.userId }, b);
  }

  @Get('audit.csv')
  @RequirePermission('audit.read')
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="audit-log.csv"')
  auditCsv(@Query('action') action?: string, @Query('actorId') actorId?: string, @Query('from') from?: string, @Query('to') to?: string) {
    return this.ops.auditCsv({ action, actorId, from, to });
  }
}

/** Public announcement/maintenance banner (display-only). */
@Public()
@Controller('marketplace')
export class PublicOpsController {
  constructor(private readonly ops: OpsService) {}

  @Get('announcement')
  banner() {
    return this.ops.publicBanner();
  }
}
