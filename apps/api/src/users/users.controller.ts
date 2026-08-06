import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { updateProfileSchema, type UpdateProfileInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser, Public } from '../common/decorators';
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

  /**
   * Server-side avatar upload: raw bytes in, moderation outcome out.
   *
   * This is the ONLY way an avatar is set. The old presign/confirm pair was
   * removed with the face check: `confirm` took a storage key on trust, so a
   * client could have uploaded any image and had it published without ever being
   * checked. One endpoint that owns validation, the face check, and persistence
   * leaves no path around the policy.
   */
  @Post('avatar/upload')
  uploadAvatar(@CurrentUser() user: AuthContext, @Req() req: Request) {
    return this.users.uploadAvatar(user.userId, rawBody(req), uploadFileName(req));
  }

  @Delete('avatar')
  removeAvatar(@CurrentUser() user: AuthContext) {
    return this.users.removeAvatar(user.userId);
  }
}

/**
 * Public read side of profile pictures.
 *
 * An approved profile picture is public by definition — the whole point is that
 * other people see who they are dealing with — so this route is unauthenticated
 * and can be used directly as an `<img src>` from the web app, the admin app and
 * mobile without cookies or CORS involvement.
 *
 * It only ever serves APPROVED pictures belonging to ACTIVE accounts; pending and
 * rejected images stay behind the owner-only signed URL in `/me`. Callers get a
 * 404 otherwise and render initials instead.
 */
@Controller('users')
export class UserAvatarController {
  constructor(private readonly users: UsersService) {}

  @Public()
  @Get(':id/avatar')
  async avatar(@Param('id') id: string, @Res() res: Response): Promise<void> {
    // helmet() defaults to Cross-Origin-Resource-Policy: same-origin, which would
    // block this image whenever it IS loaded cross-origin (mobile, or any client
    // not going through the same-origin /api proxy). A profile picture is public
    // by design, so opt this one route out.
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    const url = await this.users.approvedAvatarDownloadUrl(id);
    if (!url) {
      // Cache the "no picture" answer briefly too, so a page full of initials
      // avatars doesn't re-ask on every render.
      res.setHeader('Cache-Control', 'public, max-age=60');
      res.status(404).json({ message: 'No profile picture.' });
      return;
    }
    // Redirect rather than proxy the bytes: storage serves the image directly, so
    // the API never streams megabytes. The cache window is deliberately shorter
    // than the signed URL's TTL so a browser never follows an expired redirect.
    res.setHeader('Cache-Control', 'public, max-age=120');
    res.redirect(302, url);
  }
}
