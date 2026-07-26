import { describe, expect, it } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { Env } from '../config/env';

/** Minimal Env stub; only storage-related fields matter here. */
function env(overrides: Partial<Env>): Env {
  return {
    NODE_ENV: 'production',
    STORAGE_PROVIDER: 'none',
    STORAGE_ENDPOINT: 'http://localhost:9000',
    STORAGE_REGION: 'us-east-1',
    STORAGE_BUCKET: 'bmpl-documents',
    STORAGE_PUBLIC_BUCKET: 'bmpl-public',
    STORAGE_ACCESS_KEY_ID: 'x',
    STORAGE_SECRET_ACCESS_KEY: 'y',
    STORAGE_FORCE_PATH_STYLE: true,
    STORAGE_SIGNED_URL_TTL: 300,
    ...overrides,
  } as Env;
}

describe('StorageService when storage is not configured', () => {
  const svc = new StorageService(env({ STORAGE_PROVIDER: 'none' }));

  it('reports disabled + not_configured health (does not fail readiness)', async () => {
    expect(svc.isEnabled()).toBe(false);
    expect(await svc.healthStatus()).toBe('not_configured');
  });

  it('onModuleInit + ensureBucket are safe no-ops (no network)', async () => {
    await expect(svc.onModuleInit()).resolves.toBeUndefined();
    await expect(svc.ensureBucket('private')).resolves.toBeUndefined();
  });

  it('upload/download/head throw a clear 503 (ServiceUnavailable)', async () => {
    await expect(svc.presignUpload('applications/u/VENDOR/x/a.pdf', 'application/pdf')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(svc.presignDownload('applications/u/VENDOR/x/a.pdf')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    await expect(svc.headObject('applications/u/VENDOR/x/a.pdf')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('minio in production is treated as not configured', () => {
    expect(new StorageService(env({ STORAGE_PROVIDER: 'minio', NODE_ENV: 'production' })).isEnabled()).toBe(
      false,
    );
  });

  it('r2 is enabled', () => {
    expect(new StorageService(env({ STORAGE_PROVIDER: 'r2' })).isEnabled()).toBe(true);
  });
});
