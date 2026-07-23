/**
 * Per-worker setup. Loads the root .env, enforces TEST_DATABASE_URL, and points
 * the app's DATABASE_URL at the disposable test database before any module that
 * reads env is imported.
 */
import 'reflect-metadata';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: resolve(process.cwd(), '../../.env') });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('[integration] TEST_DATABASE_URL is required (see integration.global.ts).');
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_URL = process.env.TEST_DATABASE_URL;
process.env.JWT_ACCESS_SECRET ||= 'test-access-secret-value-1234567890';
process.env.JWT_REFRESH_SECRET ||= 'test-refresh-secret-value-1234567890';
process.env.COOKIE_SECRET ||= 'test-cookie-secret-value-1234567890';
