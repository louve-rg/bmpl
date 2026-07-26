import { z } from 'zod';

const boolFromString = (def: boolean) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined ? def : v === 'true' || v === '1'));

/** Validated environment. The API refuses to boot with invalid/missing config. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  // Railway (and most PaaS) inject PORT; fall back to API_PORT for local dev.
  PORT: z.coerce.number().int().optional(),
  API_PORT: z.coerce.number().int().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  APP_VERSION: z.string().default('0.1.0'),
  // Comma-separated allow-list of browser origins for CORS + CSRF origin checks.
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),
  LOG_FORMAT: z.enum(['pretty', 'json']).optional(),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  // Railway Redis requires TLS (rediss://). Set true when the URL is not already rediss://.
  REDIS_TLS: boolFromString(false),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_SECRET: z.string().min(16),
  // Empty string (default) => host-only cookies, correct for an API-only cloud
  // deploy and the same-origin proxy. A leading-dot value (e.g.
  // ".bzemarketplace.com") shares cookies across subdomains once web/admin exist.
  COOKIE_DOMAIN: z.string().default(''),
  COOKIE_SAMESITE: z.enum(['strict', 'lax', 'none']).default('strict'),
  // Force Secure cookies regardless of NODE_ENV (needed behind TLS in cloud dev).
  COOKIE_SECURE: boolFromString(false),

  // ---- CSRF ----
  CSRF_ENABLED: boolFromString(true),

  // ---- Rate limiting ----
  THROTTLE_TTL_SECONDS: z.coerce.number().int().default(60),
  THROTTLE_LIMIT: z.coerce.number().int().default(300), // general per-IP per window
  THROTTLE_AUTH_LIMIT: z.coerce.number().int().default(10), // login/register/etc.
  // In test, throttling is skipped unless this is set (keeps the suite deterministic).
  THROTTLE_TEST_ENABLED: boolFromString(false),

  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_SITE_URL: z.string().url().default('http://localhost:3001'),

  // ---- Object storage (S3-compatible: MinIO locally, Cloudflare R2 in cloud) ----
  // 'none' explicitly disables storage; file-upload endpoints then return a clear
  // "storage not configured" error. See storageEnabled() below.
  STORAGE_PROVIDER: z.enum(['none', 'minio', 'r2']).default('minio'),
  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'), // 'auto' for R2
  // Private bucket (verification documents, admin attachments). NEVER public.
  STORAGE_BUCKET: z.string().default('bmpl-documents'),
  // Public bucket (future: vendor logos, public images). Prep only in Phase 1.
  STORAGE_PUBLIC_BUCKET: z.string().default('bmpl-public'),
  // Optional CDN/custom-domain base for public objects; if empty, a signed URL is used.
  STORAGE_PUBLIC_BASE_URL: z.string().optional(),
  STORAGE_ACCESS_KEY_ID: z.string().default('bmpl'),
  STORAGE_SECRET_ACCESS_KEY: z.string().default('bmpl_dev_password'),
  STORAGE_FORCE_PATH_STYLE: boolFromString(true),
  STORAGE_SIGNED_URL_TTL: z.coerce.number().int().default(300),

  // ---- Email ----
  EMAIL_PROVIDER: z.enum(['console', 'resend', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('Belize Marketplace & Logistics <no-reply@bzemarketplace.com>'),
  RESEND_API_KEY: z.string().optional(),
  SMTP_URL: z.string().optional(),

  // ---- Error monitoring (Sentry) ----
  SENTRY_DSN: z.string().optional(),
  SENTRY_ENVIRONMENT: z.string().optional(),
  SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  const env = parsed.data;

  // Production safety: refuse obviously-insecure dev defaults.
  if (env.NODE_ENV === 'production') {
    const weak = [
      ['JWT_ACCESS_SECRET', env.JWT_ACCESS_SECRET],
      ['JWT_REFRESH_SECRET', env.JWT_REFRESH_SECRET],
      ['COOKIE_SECRET', env.COOKIE_SECRET],
    ].filter(([, v]) => /change-me|dev-only|test-/i.test(String(v)));
    if (weak.length) {
      throw new Error(
        `Refusing to start in production with dev placeholder secrets: ${weak
          .map(([k]) => k)
          .join(', ')}`,
      );
    }
  }
  return env;
}

export const isProd = (env: Env) => env.NODE_ENV === 'production';

/** Effective listen port: PaaS PORT wins, else API_PORT. */
export const listenPort = (env: Env): number => env.PORT ?? env.API_PORT;

/** Whether cookies should carry the Secure attribute. */
export const cookiesSecure = (env: Env): boolean => env.COOKIE_SECURE || isProd(env);

export const corsOrigins = (env: Env): string[] =>
  env.CORS_ORIGINS.split(',')
    .map((o) => o.trim())
    .filter(Boolean);

/**
 * Whether object storage is configured/usable.
 *  - 'none'  → disabled (explicit).
 *  - 'minio' → local-dev backend only; in PRODUCTION it would be a localhost
 *              placeholder, so it is treated as NOT configured (the API starts
 *              without storage and upload endpoints return a clear error).
 *  - 'r2'    → enabled (operator supplies real endpoint/credentials).
 * This lets the initial Railway (API-only) deploy start with no storage vars,
 * and never point at localhost/minio placeholders in production.
 */
export const storageEnabled = (env: Env): boolean => {
  if (env.STORAGE_PROVIDER === 'none') return false;
  if (env.STORAGE_PROVIDER === 'minio') return !isProd(env);
  return true; // 'r2'
};
