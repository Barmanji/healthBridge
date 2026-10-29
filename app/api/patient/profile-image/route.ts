import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import {
  avatarToken,
  avatarTokenPattern,
  deleteAvatarObject,
  describeStorageFailure,
  detectAvatarImage,
  maxAvatarBytes,
  putAvatarObject,
  readAvatarObject,
} from "@/lib/storage/avatar";

export const runtime = "nodejs";

const imagePath = "/api/patient/profile-image";

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to update your profile image." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxAvatarBytes + 64 * 1024) return Response.json({ error: "Choose an image smaller than 5 MB." }, { status: 413 });

  let formData: FormData;
  try { formData = await request.formData(); } catch { return Response.json({ error: "Choose a valid image." }, { status: 400 }); }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > maxAvatarBytes) return Response.json({ error: "Choose an image between 1 byte and 5 MB." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectAvatarImage(bytes);
  if (!image || (file.type && file.type !== image.type)) return Response.json({ error: "Upload a genuine PNG, JPEG, or WebP image." }, { status: 415 });

  const token = `${randomUUID()}.${image.extension}`;
  const imageUrl = `${imagePath}?v=${token}`;
  const [currentUser] = await db.select({ image: user.image }).from(user).where(eq(user.id, session.user.id)).limit(1);
  const previousToken = avatarToken(currentUser?.image ?? null, imagePath);

  try {
    await putAvatarObject("patient", session.user.id, token, bytes, image.type);
  } catch (reason) {
    console.error("patient avatar upload failed", { name: (reason as { name?: string })?.name, message: (reason as { message?: string })?.message });
    const known = describeStorageFailure(reason);
    return Response.json({ error: known?.message ?? "The image could not be saved. Please try again." }, { status: known?.status ?? 502 });
  }

  try {
    const [updated] = await db.update(user).set({ image: imageUrl }).where(eq(user.id, session.user.id)).returning({ id: user.id });
    if (!updated) throw new Error("Patient profile not found.");
  } catch (reason) {
    console.error("patient avatar update failed", { message: (reason as { message?: string })?.message });
    await deleteAvatarObject("patient", session.user.id, token);
    return Response.json({ error: "The image could not be saved. Please try again." }, { status: 502 });
  }

  if (previousToken) await deleteAvatarObject("patient", session.user.id, previousToken);
  return Response.json({ imageUrl });
}

export async function GET(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return new Response(null, { status: 401, headers: { "Cache-Control": "no-store" } });
  if (session.user.role !== "patient") return new Response(null, { status: 403, headers: { "Cache-Control": "no-store" } });
  const token = new URL(request.url).searchParams.get("v");
  if (!token || !avatarTokenPattern.test(token)) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  const [currentUser] = await db.select({ image: user.image }).from(user).where(eq(user.id, session.user.id)).limit(1);
  if (avatarToken(currentUser?.image ?? null, imagePath) !== token) return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });

  try {
    return (await readAvatarObject("patient", session.user.id, token)) ?? new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    console.error("patient avatar read failed", { name: (reason as { name?: string })?.name, message: (reason as { message?: string })?.message });
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
