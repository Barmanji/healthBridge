"use server";

import { eq } from "drizzle-orm";
import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { user } from "@/lib/db/schema";
import { patientProfileSchema } from "@/modules/patient/schemas";

export async function updatePatientProfile(input: unknown) {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session || session.user.role !== "patient") return { ok: false as const, message: "Sign in with a patient account to update this profile." };
  const parsed = patientProfileSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, message: parsed.error.issues[0]?.message ?? "Check your profile details." };
  await db.update(user).set({ name: parsed.data.name }).where(eq(user.id, session.user.id));
  revalidatePath("/patient/settings");
  revalidatePath("/patient/dashboard");
  revalidatePath("/");
  return { ok: true as const, message: "Your profile was updated." };
}
