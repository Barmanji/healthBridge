import { GetObjectCommand } from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { doctorDocuments, doctorProfiles } from "@/lib/db/schema";
import { getR2Storage } from "@/lib/storage/r2";

export const runtime = "nodejs";

type DocumentRouteProps = { params: Promise<{ documentId: string }> };

export async function GET(request: Request, { params }: DocumentRouteProps) {
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to access this document." }, { status: 401 });
  const { documentId } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) return Response.json({ error: "Document not found." }, { status: 404 });

  const [document] = await db.select({
    id: doctorDocuments.id,
    doctorId: doctorDocuments.doctorId,
    objectKey: doctorDocuments.objectKey,
    originalName: doctorDocuments.originalName,
    contentType: doctorDocuments.contentType,
  }).from(doctorDocuments).where(eq(doctorDocuments.id, documentId)).limit(1);
  if (!document) return Response.json({ error: "Document not found." }, { status: 404 });

  if (session.user.role !== "admin") {
    if (session.user.role !== "doctor") return Response.json({ error: "You cannot access this document." }, { status: 403 });
    const [ownedProfile] = await db.select({ id: doctorProfiles.id }).from(doctorProfiles).where(and(
      eq(doctorProfiles.id, document.doctorId),
      eq(doctorProfiles.userId, session.user.id),
    )).limit(1);
    if (!ownedProfile) return Response.json({ error: "You cannot access this document." }, { status: 403 });
  }

  try {
    const storage = getR2Storage();
    const object = await storage.client.send(new GetObjectCommand({ Bucket: storage.bucket, Key: document.objectKey }));
    if (!object.Body) return Response.json({ error: "Document not found." }, { status: 404 });
    const filename = encodeURIComponent(document.originalName).replace(/[!'()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
    return new Response(object.Body.transformToWebStream(), {
      headers: {
        "Content-Type": document.contentType,
        "Content-Disposition": `attachment; filename*=UTF-8''${filename}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch {
    return Response.json({ error: "The document could not be retrieved." }, { status: 502 });
  }
}
