import { afterEach, describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { StorageService } from './storage.service';
import type { Env } from '../config/env';

// MSG-2: presignDownload's own caching is unit-tested against a stubbed
// signer rather than real MinIO/R2 — the signature's VALUE never matters
// here, only how many times it was asked for and with what key, so a stub
// returning an incrementing counter per call is a clearer oracle than a real
// (and here, unreachable) S3-compatible signature would be.
let signCallCount = 0;
vi.mock('@aws-sdk/s3-request-presigner', () => ({
  getSignedUrl: vi.fn(async (_client: unknown, command: { input?: { Bucket?: string; Key?: string } }) => {
    signCallCount += 1;
    return `https://signed.example/${command.input?.Bucket}/${command.input?.Key}?sig=${signCallCount}`;
  }),
}));

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

describe('MSG-2: presignDownload caches a URL for its rotation margin, then re-signs', () => {
  afterEach(() => {
    vi.useRealTimers();
    signCallCount = 0;
  });

  it('returns the SAME url on a second call for the same (visibility, key)', async () => {
    const svc = new StorageService(env({ STORAGE_PROVIDER: 'r2' }));
    const first = await svc.presignDownload('messages/a1/photo.jpg', 'private');
    const second = await svc.presignDownload('messages/a1/photo.jpg', 'private');
    expect(second.url).toBe(first.url);
    expect(signCallCount).toBe(1); // only ever signed once
  });

  it('never shares a cache entry between private and public for the same raw key', async () => {
    const svc = new StorageService(env({ STORAGE_PROVIDER: 'r2' }));
    const priv = await svc.presignDownload('same/key.jpg', 'private');
    const pub = await svc.presignDownload('same/key.jpg', 'public');
    expect(pub.url).not.toBe(priv.url);
    expect(signCallCount).toBe(2);
  });

  it('re-signs once the rotation margin is crossed, well before the real expiry', async () => {
    vi.useFakeTimers();
    const svc = new StorageService(env({ STORAGE_PROVIDER: 'r2', STORAGE_SIGNED_URL_TTL: 300 }));
    const first = await svc.presignDownload('messages/a1/photo.jpg', 'private');
    expect(signCallCount).toBe(1);

    // Still well inside the cached window (margin is 60s at a 300s TTL) —
    // same url, no new signature.
    vi.advanceTimersByTime(200_000);
    const stillCached = await svc.presignDownload('messages/a1/photo.jpg', 'private');
    expect(stillCached.url).toBe(first.url);
    expect(signCallCount).toBe(1);

    // Past TTL - margin (300s - 60s = 240s) — must re-sign rather than ever
    // hand out a URL within 60s of going dead.
    vi.advanceTimersByTime(45_000); // total 245s elapsed
    const rotated = await svc.presignDownload('messages/a1/photo.jpg', 'private');
    expect(rotated.url).not.toBe(first.url);
    expect(signCallCount).toBe(2);
  });

  it('a short TTL still leaves a real margin, never caching for a negative/zero duration', async () => {
    vi.useFakeTimers();
    // Half of a 10s TTL (5s) is less than the 60s cap, so the margin here
    // is 5s, not 60s — the min() exists exactly for this case.
    const svc = new StorageService(env({ STORAGE_PROVIDER: 'r2', STORAGE_SIGNED_URL_TTL: 10 }));
    const first = await svc.presignDownload('short-ttl/key.jpg', 'private');
    vi.advanceTimersByTime(4_000);
    expect((await svc.presignDownload('short-ttl/key.jpg', 'private')).url).toBe(first.url);
    vi.advanceTimersByTime(2_000); // total 6s, past the 5s margin boundary
    expect((await svc.presignDownload('short-ttl/key.jpg', 'private')).url).not.toBe(first.url);
  });
});
