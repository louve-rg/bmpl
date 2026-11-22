import { Body, Controller, Delete, Get, Inject, Param, Patch, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { deleteAccountSchema, updateProfileSchema, type DeleteAccountInput, type UpdateProfileInput } from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { rawBody, uploadFileName } from '../common/raw-upload';
import { CurrentUser, Public } from '../common/decorators';
import type { AuthContext } from '../common/auth-context';
import { StrictThrottle } from '../throttling/throttle.decorators';
import { clearAuthCookies } from '../auth/cookies';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { UsersService } from './users.service';

@Controller('me')
export class UsersController {
  constructor(
    private readonly users: UsersService,
    @Inject(ENV) private readonly env: Env,
  ) {}

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

  /**
   * MDF-924: self-service account deletion. Requires the CURRENT password
   * (reauthentication — a live session alone is not enough for a one-way
   * destructive action). Refuses with a specific reason, rather than
   * deleting, if the account currently holds a live responsibility (sole
   * terminal company manager, an open vendor order, an in-progress
   * delivery/shipment job) that needs a hand-off first. Rate-limited the
   * same as the other sensitive auth/account routes.
   *
   * NOT a full erasure: profile and identity data are anonymized, but a
   * COMPLETED order or shipment keeps its own stored recipient name and
   * address, by owner ruling — see `UsersService.deleteAccount`'s own doc
   * comment. Any web-facing confirmation copy for this action must say
   * "profile anonymized, past order records retained," not "account
   * deleted" — this controller's own `{ ok: true }` response makes no such
   * claim either way, deliberately.
   */
  @StrictThrottle()
  @Delete()
  async deleteAccount(
    @CurrentUser() user: AuthContext,
    @Body(ZodBody(deleteAccountSchema)) body: DeleteAccountInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    await this.users.deleteAccount(user.userId, body, { ipAddress: req.ip });
    // Every session was just revoked, including the one that made this
    // call — clear the cookies so the browser doesn't keep offering a dead one.
    clearAuthCookies(res, this.env);
    return { ok: true };
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
