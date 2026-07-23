import {
  Body,
  Controller,
  Get,
  Inject,
  Post,
  Req,
  Res,
  UnauthorizedException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  forgotPasswordSchema,
  loginSchema,
  registerSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  verifyEmailSchema,
  type LoginInput,
  type RegisterInput,
  type ResetPasswordInput,
} from '@bmpl/validation';
import { ZodBody } from '../common/zod-validation.pipe';
import { Public } from '../common/decorators';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import { AuthService } from './auth.service';
import { SessionService, type IssuedSession } from './session.service';
import {
  ACCESS_COOKIE,
  REFRESH_COOKIE,
  clearAuthCookies,
  setAuthCookies,
} from './cookies';

function requestMeta(req: Request, fromMobile?: boolean) {
  return {
    client: fromMobile ? 'mobile' : (req.headers['x-bmpl-client'] as string) ?? 'web',
    userAgent: req.headers['user-agent'],
    ipAddress: req.ip,
  };
}

@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly sessions: SessionService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  /**
   * Deliver tokens: web/admin get HTTP-only cookies; mobile gets them in the
   * JSON body for secure-store. Both paths use the same session rotation.
   */
  private deliver(res: Response, issued: IssuedSession, fromMobile?: boolean) {
    if (fromMobile) {
      return {
        accessToken: issued.accessToken,
        refreshToken: issued.refreshToken,
        expiresIn: Math.floor(issued.accessTtlMs / 1000),
      };
    }
    setAuthCookies(res, this.env, issued);
    return { ok: true };
  }

  @Public()
  @Post('register')
  async register(
    @Body(ZodBody(registerSchema)) body: RegisterInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.register(body, requestMeta(req));
    return this.deliver(res, issued);
  }

  @Public()
  @Post('login')
  async login(
    @Body(ZodBody(loginSchema)) body: LoginInput,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const issued = await this.auth.login(body, requestMeta(req, body.fromMobile));
    return this.deliver(res, issued, body.fromMobile);
  }

  @Public()
  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: { refreshToken?: string },
  ) {
    const fromMobile = !!body?.refreshToken;
    const raw =
      body?.refreshToken ??
      (req as Request & { cookies?: Record<string, string> }).cookies?.[REFRESH_COOKIE];
    if (!raw) throw new UnauthorizedException('No refresh token provided.');
    const issued = await this.sessions.rotate(raw);
    return this.deliver(res, issued, fromMobile);
  }

  @Post('logout')
  async logout(
    @Req() req: Request & { auth?: { sessionId: string } },
    @Res({ passthrough: true }) res: Response,
  ) {
    if (req.auth) await this.auth.logout(req.auth.sessionId);
    clearAuthCookies(res, this.env);
    return { ok: true };
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body(ZodBody(verifyEmailSchema)) body: { token: string }) {
    await this.auth.verifyEmail(body.token);
    return { ok: true };
  }

  @Public()
  @Post('resend-verification')
  async resend(@Body(ZodBody(resendVerificationSchema)) body: { email: string }) {
    await this.auth.resendVerification(body.email);
    return { ok: true };
  }

  @Public()
  @Post('forgot-password')
  async forgot(@Body(ZodBody(forgotPasswordSchema)) body: { email: string }) {
    await this.auth.forgotPassword(body.email);
    return { ok: true };
  }

  @Public()
  @Post('reset-password')
  async reset(
    @Body(ZodBody(resetPasswordSchema)) body: ResetPasswordInput,
    @Req() req: Request,
  ) {
    await this.auth.resetPassword(body, requestMeta(req));
    return { ok: true };
  }

  /** Lightweight liveness probe usable without auth. */
  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }
}
