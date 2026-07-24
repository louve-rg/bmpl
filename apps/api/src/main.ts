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
  app.use(cookieParser(env.COOKIE_SECRET));
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
