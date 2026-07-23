import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import {
  documentUploadRequestSchema,
  provideMoreInfoSchema,
  submitRoleApplicationSchema,
  switchRoleSchema,
  type SubmitRoleApplicationInput,
} from '@bmpl/validation';
import type { RoleCode } from '@bmpl/shared';
import { ZodBody } from '../common/zod-validation.pipe';
import { CurrentUser } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { RolesService } from './roles.service';

@Controller('roles')
export class RolesController {
  constructor(private readonly roles: RolesService) {}

  /** Roles the user may apply for, with their current per-role status. */
  @Get('applicable')
  applicable(@CurrentUser() user: AuthContext) {
    return this.roles.listApplicable(user.userId);
  }

  @Get('applications')
  applications(@CurrentUser() user: AuthContext) {
    return this.roles.myApplications(user.userId);
  }

  @Post('applications/:roleCode/documents/presign')
  presignDoc(
    @CurrentUser() user: AuthContext,
    @Param('roleCode') roleCode: RoleCode,
    @Body(ZodBody(documentUploadRequestSchema)) body: { fileName: string; contentType: string },
  ) {
    return this.roles.presignDocument(user.userId, roleCode, body.fileName, body.contentType);
  }

  @Post('applications')
  submit(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(submitRoleApplicationSchema)) body: SubmitRoleApplicationInput,
  ) {
    return this.roles.submitApplication(user.userId, body);
  }

  @Post('applications/:id/more-info')
  provideMoreInfo(
    @CurrentUser() user: AuthContext,
    @Param('id') id: string,
    @Body(ZodBody(provideMoreInfoSchema)) body: { message: string; documentKeys: string[] },
  ) {
    return this.roles.provideMoreInfo(user.userId, id, body.message, body.documentKeys);
  }

  /** Role switcher — activate an approved role. */
  @Post('switch')
  switch(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(switchRoleSchema)) body: { roleCode: RoleCode },
  ) {
    return this.roles.switchRole(user.userId, body.roleCode);
  }
}
