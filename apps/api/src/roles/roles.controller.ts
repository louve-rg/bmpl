import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
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
import { StrictThrottle } from '../throttling/throttle.decorators';
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

  /**
   * Legacy presign flow. Superseded by `documents/upload` — the presigned URL is
   * cross-origin to the browser and the storage bucket has no CORS policy for the
   * custom domain, which surfaced as "Failed to fetch". Retained so older clients
   * keep working; new clients POST the bytes instead.
   */
  @StrictThrottle()
  @Post('applications/:roleCode/documents/presign')
  presignDoc(
    @CurrentUser() user: AuthContext,
    @Param('roleCode') roleCode: RoleCode,
    @Body(ZodBody(documentUploadRequestSchema)) body: { fileName: string; contentType: string },
  ) {
    return this.roles.presignDocument(user.userId, roleCode, body.fileName, body.contentType);
  }

  /**
   * Server-side document upload: the browser POSTs the raw file bytes (Content-Type
   * = the document MIME) through the same-origin web `/api` proxy; the scoped raw
   * parser (see main.ts) exposes them as `req.body: Buffer`. Same transport as
   * product-image upload, so no cross-origin browser PUT to storage. Returns the
   * storage key to pass to `POST /roles/applications`.
   */
  @StrictThrottle()
  @Post('applications/:roleCode/documents/upload')
  uploadDoc(
    @CurrentUser() user: AuthContext,
    @Param('roleCode') roleCode: RoleCode,
    @Req() req: Request,
  ) {
    const body = Buffer.isBuffer(req.body) ? req.body : undefined;
    const fileName = (req.query as Record<string, string | undefined>).filename;
    return this.roles.uploadDocument(user.userId, roleCode, body, fileName);
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
