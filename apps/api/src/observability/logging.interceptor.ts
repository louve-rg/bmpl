import {
  CallHandler,
  ExecutionContext,
  Inject,
  Injectable,
  Logger,
  NestInterceptor,
} from '@nestjs/common';
import { catchError, tap, throwError } from 'rxjs';
import type { Request, Response } from 'express';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';
import type { AuthContext } from '../common/auth-context';

/**
 * Structured HTTP access logging. Emits one JSON line per request in cloud
 * environments with: request id, method, route, status, duration, and — only
 * when safe — the authenticated user id + active role. It NEVER logs bodies,
 * query strings, headers, cookies, or tokens.
 */
@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('http');
  private readonly json: boolean;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.json = (env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty')) === 'json';
  }

  intercept(context: ExecutionContext, next: CallHandler) {
    if (context.getType() !== 'http') return next.handle();
    const http = context.switchToHttp();
    const req = http.getRequest<Request & { id?: string; auth?: AuthContext }>();
    const res = http.getResponse<Response>();
    const start = Date.now();

    const write = (status: number, errorClass?: string) => {
      const durationMs = Date.now() - start;
      const route = (req.route?.path as string) ?? req.path;
      if (this.json) {
        process.stdout.write(
          JSON.stringify({
            level: status >= 500 ? 'error' : 'info',
            time: new Date().toISOString(),
            msg: 'http_request',
            service: 'bmpl-api',
            env: this.env.NODE_ENV,
            version: this.env.APP_VERSION,
            requestId: req.id,
            method: req.method,
            route,
            status,
            durationMs,
            userId: req.auth?.userId,
            role: req.auth?.activeRole ?? undefined,
            ...(errorClass ? { errorClass } : {}),
          }) + '\n',
        );
      } else {
        this.logger.log(
          `${req.method} ${route} ${status} ${durationMs}ms${req.auth ? ` user=${req.auth.userId}` : ''}`,
        );
      }
    };

    return next.handle().pipe(
      tap(() => write(res.statusCode)),
      catchError((err) => {
        const status = typeof err?.status === 'number' ? err.status : 500;
        write(status, err?.name ?? 'Error');
        return throwError(() => err);
      }),
    );
  }
}
