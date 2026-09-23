// Copyright 2026 agent-media contributors. Apache-2.0 license.

import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /** Private bucket (see WorkerConfig.r2.privateBucket). Required only by
   *  r2GetPrivateObject, which never falls back to `bucket`. */
  privateBucket?: string | null;
  publicUrl: string;
}

let _client: S3Client | null = null;

function getClient(cfg: R2Config): S3Client {
  if (!_client) {
    // S3_ENDPOINT lets a self-hoster use any S3-compatible store (MinIO, Ceph).
    // Unset → Cloudflare R2, so hosted behaviour is unchanged. MinIO needs
    // S3_FORCE_PATH_STYLE=true (buckets served as /bucket/key).
    _client = new S3Client({
      region: process.env.S3_REGION?.trim() || 'auto',
      endpoint:
        process.env.S3_ENDPOINT?.trim() ||
        `https://${cfg.accountId}.r2.cloudflarestorage.com`,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE?.trim() === 'true',
      credentials: {
        accessKeyId: cfg.accessKeyId,
        secretAccessKey: cfg.secretAccessKey,
      },
    });
  }
  return _client;
}

/**
 * Upload bytes under the vNext namespace and return the public URL.
 *
 * Key shape: vnext/primitive-runs/<run_id>/<filename>
 */
export async function r2UploadVnext(
  cfg: R2Config,
  runId: string,
  filename: string,
  body: Buffer,
  contentType: string,
): Promise<{ key: string; publicUrl: string }> {
  const key = `vnext/primitive-runs/${runId}/${filename}`;
  await getClient(cfg).send(
    new PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
    }),
  );
  return {
    key,
    publicUrl: `${cfg.publicUrl}/${key}`,
  };
}

/**
 * Read a PRIVATE object by key (server-side only; never exposed as a URL).
 * Used for draft voice audio, which api-v2 stores without public access.
 * Returns null when the key does not exist.
 */
export async function r2GetPrivateObject(cfg: R2Config, key: string): Promise<Buffer | null> {
  if (!cfg.privateBucket) {
    throw new Error('private storage is not configured: set R2_PRIVATE_BUCKET (never read from the public bucket)');
  }
  try {
    const out = await getClient(cfg).send(
      new GetObjectCommand({ Bucket: cfg.privateBucket, Key: key }),
    );
    if (!out.Body) return null;
    return Buffer.from(await out.Body.transformToByteArray());
  } catch (err) {
    const name = (err as { name?: string; Code?: string })?.name ?? (err as { Code?: string })?.Code;
    if (name === 'NoSuchKey' || name === 'NotFound') return null;
    throw err;
  }
}
