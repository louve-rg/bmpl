import { Body, Controller, Get, Patch, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import {
  avatarUploadRequestSchema,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: AuthContext) {
    return this.users.getMe(user.userId);
  }

  @Patch('profile')
  updateProfile(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(updateProfileSchema)) body: UpdateProfileInput,
  ) {
    return this.users.updateProfile(user.userId, body);
  }

  @Post('avatar/presign')
  presignAvatar(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(avatarUploadRequestSchema)) body: { fileName: string; contentType: string },
  ) {
    return this.users.presignAvatar(user.userId, body.fileName, body.contentType);
  }

  /** Server-side avatar upload: raw bytes in, storage key out. */
  @Post('avatar/upload')
  uploadAvatar(@CurrentUser() user: AuthContext, @Req() req: Request) {
    return this.users.uploadAvatar(user.userId, rawBody(req), uploadFileName(req));
  }

  @Post('avatar/confirm')
  async confirmAvatar(@CurrentUser() user: AuthContext, @Body() body: { key: string }) {
    await this.users.setAvatar(user.userId, body.key);
    return { ok: true };
  }
}
