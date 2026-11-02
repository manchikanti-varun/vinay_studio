import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import type { PrivateAssetStorage } from "./providers";

function r2Config() {
  const accountId = process.env.R2_ACCOUNT_ID;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
  const bucket = process.env.R2_BUCKET;
  if (!accountId || !accessKeyId || !secretAccessKey || !bucket) throw new Error("r2_not_configured");
  return { accountId, accessKeyId, secretAccessKey, bucket };
}

function assertPrivateKey(key: string) {
  const validPrefix = /^(originals|restoration|previews|approved|production|invoices)\//;
  if (!validPrefix.test(key) || key.includes("..") || key.startsWith("/") || key.includes("\\")) throw new Error("invalid_asset_key");
}

function client() {
  const config = r2Config();
  return { config, s3: new S3Client({ region: "auto", endpoint: `https://${config.accountId}.r2.cloudflarestorage.com`, credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey } }) };
}

export class R2PrivateAssetStorage implements PrivateAssetStorage {
  async put(key: string, bytes: Buffer, mimeType: string): Promise<void> {
    assertPrivateKey(key);
    const { config, s3 } = client();
    await s3.send(new PutObjectCommand({ Bucket: config.bucket, Key: key, Body: bytes, ContentType: mimeType, CacheControl: "private, no-store" }));
  }

  async get(key: string): Promise<{ bytes: Buffer; mimeType: string }> {
    assertPrivateKey(key);
    const { config, s3 } = client();
    const response = await s3.send(new GetObjectCommand({ Bucket: config.bucket, Key: key }));
    if (!response.Body) throw new Error("asset_not_found");
    return { bytes: Buffer.from(await response.Body.transformToByteArray()), mimeType: response.ContentType ?? "application/octet-stream" };
  }

  async delete(key: string): Promise<void> {
    assertPrivateKey(key);
    const { config, s3 } = client();
    await s3.send(new DeleteObjectCommand({ Bucket: config.bucket, Key: key }));
  }

  async createSignedReadUrl(key: string, expiresInSeconds: number): Promise<string> {
    assertPrivateKey(key);
    const { config, s3 } = client();
    const ttl = Math.min(900, Math.max(1, Math.floor(expiresInSeconds)));
    return getSignedUrl(s3, new GetObjectCommand({ Bucket: config.bucket, Key: key }), { expiresIn: ttl });
  }

  async createSignedUploadUrl(key: string, mimeType: string, expiresInSeconds: number): Promise<string> {
    assertPrivateKey(key);
    if (!["image/jpeg", "image/png", "image/webp"].includes(mimeType)) throw new Error("unsupported_image_type");
    const { config, s3 } = client();
    const ttl = Math.min(600, Math.max(1, Math.floor(expiresInSeconds)));
    return getSignedUrl(s3, new PutObjectCommand({ Bucket: config.bucket, Key: key, ContentType: mimeType, CacheControl: "private, no-store" }), { expiresIn: ttl });
  }
}
