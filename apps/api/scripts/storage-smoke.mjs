/**
 * Storage smoke test — exercises the app's real StorageService against whatever
 * S3-compatible endpoint STORAGE_* points at (MinIO locally, Cloudflare R2 in
 * cloud). Proves the private-document code path end-to-end:
 *   ensureBucket → presign PUT → upload → HEAD metadata → namespace guard →
 *   signed GET (200) → unsigned GET (403) → signed expiry (403) → cleanup.
 *
 * Run (build the API first: pnpm --filter @bmpl/api build):
 *   pnpm --filter @bmpl/api smoke:storage
 * With R2 env set, this is the Phase 1.5C Step 7 verification.
 */
import { DeleteObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { StorageService } from '../dist/storage/storage.service.js';

const ttl = Number(process.env.STORAGE_SIGNED_URL_TTL ?? 3);
const env = {
  STORAGE_PROVIDER: process.env.STORAGE_PROVIDER ?? 'minio',
  STORAGE_ENDPOINT: process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000',
  STORAGE_REGION: process.env.STORAGE_REGION ?? 'us-east-1',
  STORAGE_BUCKET: process.env.STORAGE_BUCKET ?? 'bmpl-documents',
  STORAGE_PUBLIC_BUCKET: process.env.STORAGE_PUBLIC_BUCKET ?? 'bmpl-public',
  STORAGE_ACCESS_KEY_ID: process.env.STORAGE_ACCESS_KEY_ID ?? 'bmpl',
  STORAGE_SECRET_ACCESS_KEY: process.env.STORAGE_SECRET_ACCESS_KEY ?? 'bmpl_dev_password',
  STORAGE_FORCE_PATH_STYLE:
    (process.env.STORAGE_FORCE_PATH_STYLE ?? 'true') === 'true',
  STORAGE_SIGNED_URL_TTL: ttl,
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' — ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function main() {
  const storage = new StorageService(env);
  const body = Buffer.from('%PDF-1.4\nBMPL storage smoke\n%%EOF');

  await storage.ensureBucket('private');
  check('ensureBucket(private)', true, `provider=${env.STORAGE_PROVIDER}`);

  const prefix = `applications/smoke-user/VENDOR`;
  const key = storage.buildKey(prefix, 'smoke-doc.pdf');
  check('randomized namespaced key', key.startsWith(prefix + '/') && key !== `${prefix}/smoke-doc.pdf`, key);

  // Presign PUT + upload
  const { uploadUrl } = await storage.presignUpload(key, 'application/pdf');
  const put = await fetch(uploadUrl, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/pdf' },
    body,
  });
  check('upload via presigned PUT', put.status === 200, `status=${put.status}`);

  // Real metadata via HEAD
  const meta = await storage.headObject(key);
  check(
    'HEAD returns real metadata',
    !!meta && meta.contentType === 'application/pdf' && meta.sizeBytes === body.length,
    meta ? `${meta.contentType} ${meta.sizeBytes}B` : 'null',
  );

  // Namespace ownership guard
  let ownGuardOk = true;
  try {
    storage.assertKeyInNamespace(key, 'applications/OTHER-user/VENDOR');
    ownGuardOk = false; // should have thrown
  } catch {
    /* expected */
  }
  check("foreign namespace rejected", ownGuardOk);

  // Signed GET works + bytes match
  const { url: signed } = await storage.presignDownload(key);
  const g = await fetch(signed);
  const got = Buffer.from(await g.arrayBuffer());
  check('signed GET works + bytes match', g.status === 200 && got.equals(body), `status=${g.status}`);

  // Unsigned GET is forbidden (private bucket)
  const unsignedUrl = `${env.STORAGE_ENDPOINT.replace(/\/$/, '')}/${env.STORAGE_BUCKET}/${key}`;
  const u = await fetch(unsignedUrl);
  check('unsigned GET forbidden', u.status === 403 || u.status === 401, `status=${u.status}`);

  // Signed URL expires
  if (ttl <= 10) {
    await sleep((ttl + 1) * 1000);
    const e = await fetch(signed);
    check('signed GET expires', e.status === 403 || e.status === 400, `status=${e.status}`);
  } else {
    console.log(`SKIP  signed expiry (TTL=${ttl}s too long to wait)`);
  }

  // Cleanup
  const client = new S3Client({
    region: env.STORAGE_REGION,
    endpoint: env.STORAGE_ENDPOINT,
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.STORAGE_ACCESS_KEY_ID,
      secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
    },
  });
  await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: key }));
  check('cleanup (delete test object)', true);

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
  process.exit(failed.length === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('storage-smoke error:', err);
  process.exit(1);
});
