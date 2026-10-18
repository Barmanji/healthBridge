import { DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { getR2Storage } from "@/lib/storage/r2";

export const runtime = "nodejs";

const maxBytes = 5 * 1024 * 1024;
const tokenPattern = /^([0-9a-f-]{36})\.(png|jpg|webp)$/i;

function detectImage(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { type: "image/png", extension: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { type: "image/jpeg", extension: "jpg" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { type: "image/webp", extension: "webp" };
  return null;
}

function ownedToken(image: string | null) {
  if (!image) return null;
  const url = new URL(image, "http://health-bridge.local");
  if (url.pathname !== "/api/patient/profile-image") return null;
  const token = url.searchParams.get("v");
  return token && tokenPattern.test(token) ? token : null;
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to update your profile image." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes + 64 * 1024) return Response.json({ error: "Choose an image smaller than 5 MB." }, { status: 413 });

  let formData: FormData;
  try { formData = await request.formData(); } catch { return Response.json({ error: "Choose a valid image." }, { status: 400 }); }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > maxBytes) return Response.json({ error: "Choose an image between 1 byte and 5 MB." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectImage(bytes);
  if (!image || (file.type && file.type !== image.type)) return Response.json({ error: "Upload a genuine PNG, JPEG, or WebP image." }, { status: 415 });

  let storage: ReturnType<typeof getR2Storage>;
  try { storage = getR2Storage(); } catch { return Response.json({ error: "Profile image storage is not configured." }, { status: 503 }); }

  const token = `${randomUUID()}.${image.extension}`;
  const objectKey = `patient-avatars/${session.user.id}/${token}`;
  const imageUrl = `/api/patient/profile-image?v=${token}`;
  const [currentUser] = await db.select({ image: user.image }).from(user).where(eq(user.id, session.user.id)).limit(1);
  const previousToken = ownedToken(currentUser?.image ?? null);

  try {
    await storage.client.send(new PutObjectCommand({ Bucket: storage.bucket, Key: objectKey, Body: bytes, ContentType: image.type }));
    const [updated] = await db.update(user).set({ image: imageUrl }).where(eq(user.id, session.user.id)).returning({ id: user.id });
    if (!updated) throw new Error("Patient profile not found.");
    if (previousToken) {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: `patient-avatars/${session.user.id}/${previousToken}` })).catch(() => undefined);
    }
    return Response.json({ imageUrl });
  } catch {
    await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey })).catch(() => undefined);
    return Response.json({ error: "The image could not be saved. Please try again." }, { status: 502 });
  }
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (session.user.role !== "patient") return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const token = new URL(request.url).searchParams.get("v");
  if (!token || !tokenPattern.test(token)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const [currentUser] = await db.select({ image: user.image }).from(user).where(eq(user.id, session.user.id)).limit(1);
  if (ownedToken(currentUser?.image ?? null) !== token) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  try {
    const storage = getR2Storage();
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: `patient-avatars/${session.user.id}/${token}` }));
    if (!object.Body) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
    const extension = token.slice(token.lastIndexOf(".") + 1).toLowerCase();
    const contentType = extension === "png" ? "image/png" : extension === "jpg" ? "image/jpeg" : "image/webp";
    return new Response(object.Body.transformToWebStream(), { headers: { "Content-Type": contentType, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" } });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
