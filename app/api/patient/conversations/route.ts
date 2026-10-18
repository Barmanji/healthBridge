import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { auditLogs, conversations, patientProfiles } from "@/lib/db/schema";
import { createConversationSchema } from "@/modules/patient/schemas";

export const runtime = "nodejs";

function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && origin !== new URL(request.url).origin) return false;
  return request.headers.get("sec-fetch-site") !== "cross-site";
}

export async function POST(request: Request) {
  if (!isSameOrigin(request)) return Response.json({ error: "Request origin could not be verified." }, { status: 403 });
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return Response.json({ error: "Sign in to start a conversation." }, { status: 401 });
  if (session.user.role !== "patient") return Response.json({ error: "Patient access is required." }, { status: 403 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: "Submit a valid request." }, { status: 400 });
  }
  const parsed = createConversationSchema.safeParse(body);
  if (!parsed.success) return Response.json({ error: parsed.error.issues[0]?.message ?? "Consent is required." }, { status: 400 });

  const [profile] = await db.select({ id: patientProfiles.id })
    .from(patientProfiles)
    .where(eq(patientProfiles.userId, session.user.id))
    .limit(1);
  if (!profile) return Response.json({ error: "Complete patient onboarding before starting a conversation." }, { status: 409 });

  const acceptedAt = new Date();
  const [conversation] = await db.insert(conversations).values({
    patientId: profile.id,
    languageCode: "hi-IN",
    aiProcessingConsentAt: acceptedAt,
  }).returning({ id: conversations.id, languageCode: conversations.languageCode, status: conversations.status });

  await db.insert(auditLogs).values({
    actorUserId: session.user.id,
    action: "conversation.created",
    entity: "conversation",
    entityId: conversation.id,
    meta: { aiProcessingConsent: true },
  });

  return Response.json({ conversation }, { status: 201 });
}
