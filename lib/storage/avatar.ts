import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { getR2Storage } from "@/lib/storage/r2";

/** Shared profile-photo handling for patients and doctors. */
export const maxAvatarBytes = 5 * 1024 * 1024;
export const avatarTokenPattern = /^([0-9a-f-]{36})\.(png|jpg|webp)$/i;

export type AvatarKind = "patient" | "doctor";

const folderByKind: Record<AvatarKind, string> = {
  patient: "patient-avatars",
  doctor: "doctor-avatars",
};

export function detectAvatarImage(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { type: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { type: "image/webp", extension: "webp" };
  return null;
}

/** Reads the version token out of a stored `user.image` value, or null when it is not ours. */
export function avatarToken(image: string | null, pathname: string) {
  if (!image) return null;
  try {
    const url = new URL(image, "http://health-bridge.local");
    if (url.pathname !== pathname) return null;
    const token = url.searchParams.get("v");
    return token && avatarTokenPattern.test(token) ? token : null;
  } catch {
    return null;
  }
}

export function avatarObjectKey(kind: AvatarKind, userId: string, token: string) {
  return `${folderByKind[kind]}/${userId}/${token}`;
}

export function avatarContentType(token: string) {
  const extension = token.slice(token.lastIndexOf(".") + 1).toLowerCase();
  return extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp";
}

export async function putAvatarObject(kind: AvatarKind, userId: string, token: string, body: Uint8Array, contentType: string) {
  const storage = getR2Storage();
  await storage.client.send(new PutObjectCommand({
    Bucket: storage.bucket,
    Key: avatarObjectKey(kind, userId, token),
    Body: body,
    ContentType: contentType,
  }));
}

export async function deleteAvatarObject(kind: AvatarKind, userId: string, token: string) {
  try {
    const storage = getR2Storage();
    await storage.client.send(new DeleteObjectCommand({
      Bucket: storage.bucket,
      Key: avatarObjectKey(kind, userId, token),
    }));
  } catch {
    // Orphaned objects are harmless; a stale photo is never served because the
    // URL token in `user.image` is what grants access.
  }
}

export async function readAvatarObject(kind: AvatarKind, userId: string, token: string) {
  const storage = getR2Storage();
  const object = await storage.client.send(new GetObjectCommand({
    Bucket: storage.bucket,
    Key: avatarObjectKey(kind, userId, token),
  }));
  if (!object.Body) return null;
  return new Response(object.Body.transformToWebStream(), {
    headers: {
      "Content-Type": avatarContentType(token),
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}

/**
 * Turns an SDK failure into something the person uploading can act on. Cloudflare
 * returns these as 403/404 S3 codes, which are configuration problems rather than
 * transient upload failures, so they should not read as "try again".
 */
export function describeStorageFailure(error: unknown) {
  const name = typeof error === "object" && error !== null && "name" in error ? String(error.name) : "";
  if (name === "NoSuchBucket" || name === "NotFound") {
    return { status: 503, message: "Profile photo storage is misconfigured: the R2 bucket was not found." };
  }
  if (name === "AccessDenied" || name === "InvalidAccessKeyId" || name === "SignatureDoesNotMatch") {
    return { status: 503, message: "Profile photo storage rejected the R2 credentials. Check the R2 API token permissions." };
  }
  return null;
}
