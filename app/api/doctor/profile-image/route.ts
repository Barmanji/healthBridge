import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { doctorProfiles, user } from "@/lib/db/schema";
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

const imagePath = "/api/doctor/profile-image";

/**
 * Doctor photos are shown in the public directory, so the token in the URL is the
 * only credential needed to read one. It is a random UUID that changes on every
 * upload, and the profile id in the query keeps the R2 object key derivable.
 */
export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to update your profile photo." }, { status: 401 });
  if (session.user.role !== "doctor") return Response.json({ error: "Doctor access is required." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxAvatarBytes + 64 * 1024) return Response.json({ error: "Choose an image smaller than 5 MB." }, { status: 413 });

  let formData: FormData;
  try { formData = await request.formData(); } catch { return Response.json({ error: "Choose a valid image." }, { status: 400 }); }
  const file = formData.get("file");
  if (!(file instanceof File) || file.size < 1 || file.size > maxAvatarBytes) return Response.json({ error: "Choose an image between 1 byte and 5 MB." }, { status: 400 });

  const bytes = new Uint8Array(await file.arrayBuffer());
  const image = detectAvatarImage(bytes);
  if (!image || (file.type && file.type !== image.type)) return Response.json({ error: "Upload a genuine PNG, JPEG, or WebP image." }, { status: 415 });

  const [profile] = await db.select({ id: doctorProfiles.id }).from(doctorProfiles).where(eq(doctorProfiles.userId, session.user.id)).limit(1);
  if (!profile) return Response.json({ error: "Start your doctor application before adding a photo." }, { status: 409 });

  const [currentUser] = await db.select({ image: user.image }).from(user).where(eq(user.id, session.user.id)).limit(1);
  const previousToken = avatarToken(currentUser?.image ?? null, imagePath);
  const token = `${randomUUID()}.${image.extension}`;
  const imageUrl = `${imagePath}?d=${profile.id}&v=${token}`;

  try {
    await putAvatarObject("doctor", session.user.id, token, bytes, image.type);
  } catch (reason) {
    console.error("doctor avatar upload failed", { name: (reason as { name?: string })?.name, message: (reason as { message?: string })?.message });
    const known = describeStorageFailure(reason);
    return Response.json({ error: known?.message ?? "The image could not be saved. Please try again." }, { status: known?.status ?? 502 });
  }

  try {
    const [updated] = await db.update(user).set({ image: imageUrl }).where(eq(user.id, session.user.id)).returning({ id: user.id });
    if (!updated) throw new Error("Doctor account not found.");
  } catch (reason) {
    console.error("doctor avatar update failed", { message: (reason as { message?: string })?.message });
    await deleteAvatarObject("doctor", session.user.id, token);
    return Response.json({ error: "The image could not be saved. Please try again." }, { status: 502 });
  }

  if (previousToken) await deleteAvatarObject("doctor", session.user.id, previousToken);
  return Response.json({ imageUrl });
}

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const doctorId = params.get("d");
  const token = params.get("v");
  if (!doctorId || !/^[0-9a-f-]{36}$/i.test(doctorId) || !token || !avatarTokenPattern.test(token)) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  const [owner] = await db.select({ userId: doctorProfiles.userId, image: user.image })
    .from(doctorProfiles)
    .innerJoin(user, eq(user.id, doctorProfiles.userId))
    .where(eq(doctorProfiles.id, doctorId))
    .limit(1);
  if (!owner || avatarToken(owner.image, imagePath) !== token) {
    return new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  }

  try {
    return (await readAvatarObject("doctor", owner.userId, token)) ?? new Response(null, { status: 404, headers: { "Cache-Control": "no-store" } });
  } catch (reason) {
    console.error("doctor avatar read failed", { name: (reason as { name?: string })?.name, message: (reason as { message?: string })?.message });
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
