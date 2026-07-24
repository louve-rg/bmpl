import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  restoreRoleSchema,
  reviewApproveSchema,
  reviewMoreInfoSchema,
  reviewRejectSchema,
  revokeRoleSchema,
  setAdminPermissionsSchema,
  suspendRoleSchema,
  suspendUserSchema,
  userSearchSchema,
} from '@bmpl/validation';
import type { Permission, RoleCode } from '@bmpl/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser, RequirePermission } from '../common/decorators';
import { StrictThrottle } from '../throttling/throttle.decorators';
import type { AuthContext } from '../common/auth-context';
import { AdminService } from './admin.service';

/**
 * All admin routes require an explicit AdminPermission (rule #2/#4: admin
 * capability is separate from customer-facing roles). The PermissionsGuard
 * enforces these on the backend regardless of what the UI shows.
 */
@Controller('admin')
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  private actor(user: AuthContext, req: Request) {
    return { userId: user.userId, ipAddress: req.ip, sessionId: user.sessionId };
  }

  @Get('summary')
  @RequirePermission('users.read')
  summary() {
    return this.admin.dashboardSummary();
  }

  @Get('users')
  @RequirePermission('users.read')
  searchUsers(@Query(ZodBody(userSearchSchema)) query: ReturnType<typeof userSearchSchema.parse>) {
    return this.admin.searchUsers(query);
  }

  @Get('users/:id')
  @RequirePermission('users.read')
  getUser(@Param('id') id: string) {
    return this.admin.getUser(id);
  }

  @Get('applications')
  @RequirePermission('role_applications.read')
  queue(@Query('status') status?: 'PENDING' | 'MORE_INFO_REQUIRED') {
    return this.admin.applicationQueue(status);
  }

  @Get('applications/:id')
  @RequirePermission('role_applications.read')
  application(@Param('id') id: string) {
    return this.admin.getApplication(id);
  }

  @StrictThrottle()
  @Get('documents/:id/url')
  @RequirePermission('documents.read')
  documentUrl(@Param('id') id: string) {
    return this.admin.getDocumentUrl(id);
  }

  @Post('applications/approve')
  @RequirePermission('role_applications.review')
  approve(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(reviewApproveSchema)) body: { applicationId: string; note?: string },
  ) {
    return this.admin.approve(body.applicationId, this.actor(user, req), body.note);
  }

  @Post('applications/reject')
  @RequirePermission('role_applications.review')
  reject(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(reviewRejectSchema)) body: { applicationId: string; reason: string },
  ) {
    return this.admin.reject(body.applicationId, this.actor(user, req), body.reason);
  }

  @Post('applications/request-more-info')
  @RequirePermission('role_applications.review')
  moreInfo(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(reviewMoreInfoSchema)) body: { applicationId: string; message: string },
  ) {
    return this.admin.requestMoreInfo(body.applicationId, this.actor(user, req), body.message);
  }

  @Post('roles/suspend')
  @RequirePermission('roles.suspend')
  suspendRole(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(suspendRoleSchema)) body: { userId: string; roleCode: RoleCode; reason: string },
  ) {
    return this.admin.suspendRole(this.actor(user, req), body.userId, body.roleCode, body.reason);
  }

  @Post('roles/restore')
  @RequirePermission('roles.restore')
  restoreRole(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(restoreRoleSchema)) body: { userId: string; roleCode: RoleCode; note?: string },
  ) {
    return this.admin.restoreRole(this.actor(user, req), body.userId, body.roleCode, body.note);
  }

  @Post('roles/revoke')
  @RequirePermission('roles.revoke')
  revokeRole(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(revokeRoleSchema)) body: { userId: string; roleCode: RoleCode; reason: string },
  ) {
    return this.admin.revokeRole(this.actor(user, req), body.userId, body.roleCode, body.reason);
  }

  @Post('users/suspend')
  @RequirePermission('users.suspend')
  suspendUser(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(suspendUserSchema)) body: { userId: string; reason: string },
  ) {
    return this.admin.suspendUser(this.actor(user, req), body.userId, body.reason);
  }

  @Post('users/restore')
  @RequirePermission('users.restore')
  restoreUser(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body() body: { userId: string },
  ) {
    return this.admin.restoreUser(this.actor(user, req), body.userId);
  }

  @Get('audit')
  @RequirePermission('audit.read')
  audit(
    @Query('targetUserId') targetUserId?: string,
    @Query('page') page = '1',
    @Query('pageSize') pageSize = '25',
  ) {
    return this.admin.listAudit({
      targetUserId,
      page: Number(page),
      pageSize: Number(pageSize),
    });
  }

  @Get('users/:id/permissions')
  @RequirePermission('admin.manage')
  getPermissions(@Param('id') id: string) {
    return this.admin.getPermissions(id);
  }

  @Post('permissions')
  @RequirePermission('admin.manage')
  setPermissions(
    @CurrentUser() user: AuthContext,
    @Req() req: Request,
    @Body(ZodBody(setAdminPermissionsSchema)) body: { userId: string; permissions: Permission[] },
  ) {
    return this.admin.setPermissions(this.actor(user, req), body.userId, body.permissions);
  }
}
