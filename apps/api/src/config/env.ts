import { z } from 'zod';

/** Validated environment. The API refuses to boot with invalid/missing config. */
const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().default(4000),
  API_URL: z.string().url().default('http://localhost:4000'),
  CORS_ORIGINS: z.string().default('http://localhost:3000,http://localhost:3001'),

  DATABASE_URL: z.string().min(1),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16),
  JWT_REFRESH_SECRET: z.string().min(16),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL: z.string().default('30d'),
  COOKIE_SECRET: z.string().min(16),
  COOKIE_DOMAIN: z.string().default('localhost'),

  NEXT_PUBLIC_SITE_URL: z.string().url().default('http://localhost:3000'),
  ADMIN_SITE_URL: z.string().url().default('http://localhost:3001'),

  STORAGE_ENDPOINT: z.string().default('http://localhost:9000'),
  STORAGE_REGION: z.string().default('us-east-1'),
  STORAGE_BUCKET: z.string().default('bmpl-documents'),
  STORAGE_ACCESS_KEY_ID: z.string().default('bmpl'),
  STORAGE_SECRET_ACCESS_KEY: z.string().default('bmpl_dev_password'),
  STORAGE_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),
  STORAGE_SIGNED_URL_TTL: z.coerce.number().int().default(300),

  EMAIL_TRANSPORT: z.enum(['console', 'smtp']).default('console'),
  EMAIL_FROM: z.string().default('Belize Marketplace & Logistics <no-reply@bzemarketplace.com>'),
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
  return parsed.data;
}

export const isProd = (env: Env) => env.NODE_ENV === 'production';
