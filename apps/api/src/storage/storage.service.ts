import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  type OnModuleInit,
} from '@nestjs/common';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ENV } from '../config/config.module';
import type { Env } from '../config/env';

export interface ObjectMetadata {
  contentType: string;
  sizeBytes: number;
}

/**
 * S3-compatible private object storage (MinIO in dev; R2/S3/Supabase in prod).
 *
 * Documents are NEVER public. Uploads and downloads both go through short-lived
 * signed URLs (rules #5, #6). The private bucket is created automatically on
 * startup so there is no manual bootstrap step.
 */
@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;

  constructor(@Inject(ENV) private readonly env: Env) {
    this.client = new S3Client({
      region: env.STORAGE_REGION,
      endpoint: env.STORAGE_ENDPOINT,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureBucket();
  }

  /** Create the private bucket if it does not exist (idempotent bootstrap). */
  async ensureBucket(): Promise<void> {
    const Bucket = this.env.STORAGE_BUCKET;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket }));
    } catch {
      try {
        await this.client.send(new CreateBucketCommand({ Bucket }));
        this.logger.log(`Created private storage bucket "${Bucket}".`);
      } catch (err) {
        // A concurrent creator or an already-owned bucket is fine; anything else
        // must surface loudly so we never silently run without real storage.
        this.logger.warn(`Bucket ensure for "${Bucket}" reported: ${String(err)}`);
      }
    }
  }

  /** Namespaced, unguessable storage key under the given owner-scoped prefix. */
  buildKey(prefix: string, fileName: string): string {
    const safe = fileName.replace(/[^\w.\-]+/g, '_').slice(-80);
    return `${prefix}/${randomUUID()}/${safe}`;
  }

  /**
   * Ownership guard: a stored key must live under the exact owner-scoped prefix
   * before we ever attach it to a record. Prevents a user from referencing
   * another user's object by guessing/replaying a key.
   */
  assertKeyInNamespace(key: string, expectedPrefix: string): void {
    if (!key.startsWith(`${expectedPrefix}/`)) {
      throw new BadRequestException('Storage key does not belong to you.');
    }
  }

  /** Presigned PUT URL the client uploads directly to. */
  async presignUpload(
    key: string,
    contentType: string,
  ): Promise<{ uploadUrl: string; key: string; expiresIn: number }> {
    const command = new PutObjectCommand({
      Bucket: this.env.STORAGE_BUCKET,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(this.client, command, {
      expiresIn: this.env.STORAGE_SIGNED_URL_TTL,
    });
    return { uploadUrl, key, expiresIn: this.env.STORAGE_SIGNED_URL_TTL };
  }

  /** Short-lived GET URL for viewing a private object (admin document review). */
  async presignDownload(key: string): Promise<{ url: string; expiresIn: number }> {
    const command = new GetObjectCommand({
      Bucket: this.env.STORAGE_BUCKET,
      Key: key,
    });
    const url = await getSignedUrl(this.client, command, {
      expiresIn: this.env.STORAGE_SIGNED_URL_TTL,
    });
    return { url, expiresIn: this.env.STORAGE_SIGNED_URL_TTL };
  }

  /**
   * Inspect an uploaded object to read its REAL content type and size. Returns
   * null when the object does not exist (upload never completed). This is the
   * source of truth for stored document metadata — not client-declared values.
   */
  async headObject(key: string): Promise<ObjectMetadata | null> {
    try {
      const res = await this.client.send(
        new HeadObjectCommand({ Bucket: this.env.STORAGE_BUCKET, Key: key }),
      );
      return {
        contentType: res.ContentType ?? 'application/octet-stream',
        sizeBytes: Number(res.ContentLength ?? 0),
      };
    } catch {
      return null;
    }
  }
}
