import { S3Client } from "@aws-sdk/client-s3";
import { z } from "zod";

const r2EnvSchema = z.object({
  R2_ACCOUNT_ID: z.string().trim().min(1),
  R2_ACCESS_KEY_ID: z.string().trim().min(1),
  R2_SECRET_ACCESS_KEY: z.string().min(1),
  R2_BUCKET_NAME: z.string().trim().min(3).max(63),
});

let cachedClient: S3Client | undefined;

export function getR2Storage() {
  const parsed = r2EnvSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error("R2 storage requires R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, and R2_BUCKET_NAME.");
  }
  if (!cachedClient) {
    cachedClient = new S3Client({
      region: "auto",
      endpoint: `https://${parsed.data.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
      forcePathStyle: true,
      credentials: {
        accessKeyId: parsed.data.R2_ACCESS_KEY_ID,
        secretAccessKey: parsed.data.R2_SECRET_ACCESS_KEY,
      },
    });
  }
  return { client: cachedClient, bucket: parsed.data.R2_BUCKET_NAME };
}
