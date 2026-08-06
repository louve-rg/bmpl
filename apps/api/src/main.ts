import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';
// Load the monorepo-root .env (dev/local). In production, real environment
// variables take precedence and the (absent) file load is a harmless no-op.
loadDotenv({ path: resolve(process.cwd(), '../../.env') });
loadDotenv();

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NextFunction, Request, Response } from 'express';
import { MAX_DOCUMENT_BYTES, MAX_PRODUCT_IMAGE_BYTES } from '@bmpl/shared';
import { rawUploadBody } from './common/raw-upload-body.middleware';
import { AppModule } from './app.module';
import { loadEnv, listenPort, corsOrigins } from './config/env';
import { StructuredLogger } from './observability/structured-logger';
import { requestIdMiddleware } from './observability/request-id.middleware';
import { initSentry } from './observability/sentry';

// Ensure BigInt (wallet minor units) serializes cleanly to JSON as a string.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const env = loadEnv();
  const sentryEnabled = initSentry(env);

  const logFormat = env.LOG_FORMAT ?? (env.NODE_ENV === 'production' ? 'json' : 'pretty');
  const app = await NestFactory.create(AppModule, {
    bufferLogs: false,
    logger: new StructuredLogger({
      format: logFormat,
      env: env.NODE_ENV,
      version: env.APP_VERSION,
    }),
  });

  app.use(requestIdMiddleware);
  app.use(helmet());
  // Non-secret build identifier so a domain/deploy audit can prove which commit
  // each environment is serving (Railway injects RAILWAY_GIT_COMMIT_SHA).
  const apiCommit = (
    process.env.RAILWAY_GIT_COMMIT_SHA ??
    process.env.GIT_COMMIT_SHA ??
    env.APP_VERSION ??
    'dev'
  ).slice(0, 12);
  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-BMPL-Api-Commit', apiCommit);
    next();
  });
  app.use(cookieParser(env.COOKIE_SECRET));
  // Raw-body parser SCOPED to binary upload content types: product images and
  // private documents POST the file bytes directly (browser → same-origin web proxy
  // → API → storage), so the controller reads `req.body` as a Buffer. JSON/urlencoded
  // bodies are untouched (they don't match these content types). Cap slightly above
  // the largest per-kind limit; each service enforces its exact MAX on the actual
  // buffer.
  app.use(rawUploadBody(Math.max(MAX_PRODUCT_IMAGE_BYTES, MAX_DOCUMENT_BYTES) + 1024 * 1024));
  app.setGlobalPrefix('api');
  // Trust the reverse proxy (Railway/Vercel) so req.ip and x-forwarded-* are honored.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // Request validation is done per-route with Zod (ZodValidationPipe); we
  // deliberately do NOT use the class-validator ValidationPipe.

  app.enableCors({ origin: corsOrigins(env), credentials: true });

  // Graceful shutdown: run Nest lifecycle hooks (Prisma/Redis disconnect) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const port = listenPort(env);
  await app.listen(port, '0.0.0.0');
  const log = new Logger('Bootstrap');
  log.log(`BMPL API listening on :${port} (prefix /api, env=${env.NODE_ENV})`);
  log.log(`Sentry: ${sentryEnabled ? 'enabled' : 'disabled'} · logs: ${logFormat}`);
}

void bootstrap();
