import { randomUUID } from "node:crypto";
import { DeleteObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { doctorDocuments, doctorProfiles } from "@/lib/db/schema";
import { getR2Storage } from "@/lib/storage/r2";

export const runtime = "nodejs";

const maxFileBytes = 10 * 1024 * 1024;
const documentTypes = ["registration_certificate", "degree_certificate", "government_id", "profile_photo"] as const;
type DocumentType = (typeof documentTypes)[number];

function detectContentType(bytes: Uint8Array) {
  if (bytes.length >= 5 && new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-") return "application/pdf";
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  return null;
}

function cleanFileName(name: string) {
  const basename = name.split(/[\\/]/).pop() ?? "document";
  return basename.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 180) || "document";
}

export async function POST(request: Request) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to upload documents." }, { status: 401 });
  if (session.user.role !== "doctor") return Response.json({ error: "Doctor access is required." }, { status: 403 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxFileBytes + 64 * 1024) {
    return Response.json({ error: "Files must be 10 MB or smaller." }, { status: 413 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: "Choose a valid file to upload." }, { status: 400 });
  }
  const file = formData.get("file");
  const type = formData.get("type");
  if (!(file instanceof File) || file.size < 1 || file.size > maxFileBytes) {
    return Response.json({ error: "Choose a file between 1 byte and 10 MB." }, { status: 400 });
  }
  if (typeof type !== "string" || !documentTypes.includes(type as DocumentType)) {
    return Response.json({ error: "Choose a supported document category." }, { status: 400 });
  }

  const [profile] = await db.select().from(doctorProfiles).where(eq(doctorProfiles.userId, session.user.id)).limit(1);
  if (!profile || !["draft", "needs_info"].includes(profile.verificationStatus)) {
    return Response.json({ error: "This application is not accepting document uploads." }, { status: 409 });
  }

  const bytes = new Uint8Array(await file.arrayBuffer());
  const actualType = detectContentType(bytes);
  if (!actualType || (file.type && file.type !== actualType)) {
    return Response.json({ error: "Upload a genuine PDF, PNG, or JPEG file." }, { status: 415 });
  }
  if (type === "profile_photo" && actualType === "application/pdf") {
    return Response.json({ error: "Profile photos must be PNG or JPEG images." }, { status: 415 });
  }

  let storage: ReturnType<typeof getR2Storage>;
  try {
    storage = getR2Storage();
  } catch {
    return Response.json({ error: "Document storage is not configured yet." }, { status: 503 });
  }

  const objectKey = `doctor-documents/${profile.id}/${randomUUID()}`;
  const originalName = cleanFileName(file.name);
  try {
    await storage.client.send(new PutObjectCommand({
      Bucket: storage.bucket,
      Key: objectKey,
      Body: bytes,
      ContentType: actualType,
      Metadata: { doctortype: type },
    }));
    const [savedDocument] = await db.insert(doctorDocuments).values({
      doctorId: profile.id,
      type: type as DocumentType,
      objectKey,
      originalName,
      contentType: actualType,
      sizeBytes: bytes.byteLength,
    }).returning({ id: doctorDocuments.id, type: doctorDocuments.type, originalName: doctorDocuments.originalName });

    if (type === "profile_photo") {
      await db.update(doctorProfiles).set({ profilePhotoDocumentId: savedDocument.id }).where(eq(doctorProfiles.id, profile.id));
    }
    return Response.json({ document: savedDocument }, { status: 201 });
  } catch {
    try {
      await storage.client.send(new DeleteObjectCommand({ Bucket: storage.bucket, Key: objectKey }));
    } catch {
      // Keep the original failure generic; orphan cleanup can be retried operationally.
    }
    return Response.json({ error: "The document could not be stored. Please try again." }, { status: 502 });
  }
}
