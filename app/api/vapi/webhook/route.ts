import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { db } from "@/lib/db";
import { voiceSessions } from "@/lib/db/schema";
import { z } from "zod";

export const runtime = "nodejs";

const maxBodyBytes = 32 * 1024;
const webhookSchema = z.object({
  message: z.object({
    type: z.string().max(100),
    call: z.object({ id: z.string().min(1).max(128) }).optional(),
  }).passthrough().optional(),
  type: z.string().max(100).optional(),
  call: z.object({ id: z.string().min(1).max(128) }).optional(),
}).passthrough();

function signatureIsValid(rawBody: string, signature: string, secret: string) {
  const match = /^sha256=([a-f0-9]{64})$/i.exec(signature);
  if (!match) return false;
  const expected = createHmac("sha256", secret).update(rawBody).digest();
  const received = Buffer.from(match[1]!, "hex");
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export async function POST(request: Request) {
  const secret = process.env.VAPI_WEBHOOK_SECRET;
  if (!secret) return Response.json({ error: "Webhook authentication is not configured." }, { status: 503 });

  const contentLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBodyBytes) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  const rawBody = await request.text();
  if (new TextEncoder().encode(rawBody).byteLength > maxBodyBytes) {
    return Response.json({ error: "Request is too large." }, { status: 413 });
  }
  let parsed: unknown;
  try { parsed = JSON.parse(rawBody); } catch {
    return Response.json({ error: "Invalid JSON." }, { status: 400 });
  }
  const signature = request.headers.get("x-vapi-signature");
  if (!signature || !signatureIsValid(JSON.stringify(parsed), signature, secret)) {
    return Response.json({ error: "Webhook signature is invalid." }, { status: 401 });
  }
  const payload = webhookSchema.safeParse(parsed);
  if (!payload.success) return Response.json({ error: "Invalid webhook payload." }, { status: 400 });

  const type = payload.data.message?.type ?? payload.data.type;
  const callId = payload.data.call?.id ?? payload.data.message?.call?.id;
  if (type === "end-of-call-report" && callId) {
    await db.update(voiceSessions).set({ revokedAt: new Date() }).where(and(
      eq(voiceSessions.vapiCallId, callId),
      isNull(voiceSessions.revokedAt),
    ));
  }
  return Response.json({ received: true });
}
