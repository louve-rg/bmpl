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
import { loadEnv } from './config/env';

// Ensure BigInt (wallet minor units) serializes cleanly to JSON as a string.
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function () {
  return this.toString();
};

async function bootstrap() {
  const env = loadEnv();
  const app = await NestFactory.create(AppModule, { bufferLogs: false });

  app.use(helmet());
  app.use(cookieParser(env.COOKIE_SECRET));
  app.setGlobalPrefix('api');
  // Trust the reverse proxy so req.ip reflects the real client for audit logs.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);
  // NOTE: request validation is done per-route with Zod (ZodValidationPipe);
  // we deliberately do NOT use the class-validator ValidationPipe.

  const origins = env.CORS_ORIGINS.split(',').map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });

  await app.listen(env.API_PORT);
  new Logger('Bootstrap').log(`BMPL API listening on ${env.API_URL} (prefix /api)`);
}

void bootstrap();
