import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().trim().min(1),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().trim().min(3).max(63),
});

let cachedClient: S3Client | undefined;

/**
 * Cloudflare shows the S3 endpoint as a URL and the account ID as a bare hex string,
 * so either form gets pasted into R2_ACCOUNT_ID. Accept both instead of building
 * `https://https://<account>.r2.cloudflarestorage.com`, which fails with ENOTFOUND.
 */
function r2Endpoint(value: string) {
  const trimmed = value.trim().replace(/\/+$/, "");
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}.r2.cloudflarestorage.com`;
}

export function getR2Storage() {
  const parsed = r2EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("R2 storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: r2Endpoint(parsed.data.R2_ACCOUNT_ID),
      forcePathStyle: true,
      // Cloudflare's documented setting for the S3 SDK against R2. Newer SDKs add
      // flexible-checksum headers that R2 has been inconsistent about supporting.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
      credentials: {
        accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
        secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return { client: cachedClient, bucket: parsed.data.R2_BUCKET_NAME };
}
