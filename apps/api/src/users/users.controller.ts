import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import {
  avatarUploadRequestSchema,
  updateProfileSchema,
  type UpdateProfileInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
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

  @Post('avatar/confirm')
  async confirmAvatar(@CurrentUser() user: AuthContext, @Body() body: { key: string }) {
    await this.users.setAvatar(user.userId, body.key);
    return { ok: true };
  }
}
