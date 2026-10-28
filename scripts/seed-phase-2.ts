import "dotenv/config";
import { hashPassword } from "better-auth/crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "../lib/db";
import { account, departments, user } from "../lib/db/schema";
import { departmentSeeds } from "../lib/db/seed-data";

const bootstrapEnvSchema = z.object({
  ADMIN_BOOTSTRAP_EMAIL: z.string().trim().email().max(254),
  ADMIN_BOOTSTRAP_PASSWORD: z.string().min(16).max(128),
});

async function seedDepartments() {
  for (const [name, slug] of departmentSeeds) {
    await db.insert(departments).values({ name, slug }).onConflictDoNothing();
  }
}

async function seedAdmin(email: string, password: string) {
  const normalizedEmail = email.toLowerCase();
  const existingUser = await db.select().from(user).where(eq(user.email, normalizedEmail)).limit(1);
  if (existingUser[0]) {
    if (existingUser[0].role !== "admin") {
      throw new Error("The bootstrap email already belongs to a non-admin user; no role was changed.");
    }
    console.info("Bootstrap admin already exists; credentials were not changed.");
    return;
  }

  const existingAdmin = await db.select({ id: user.id }).from(user).where(eq(user.role, "admin")).limit(1);
  if (existingAdmin[0]) {
    throw new Error("An admin already exists with a different email; refusing to create another bootstrap admin.");
  }

  const id = crypto.randomUUID();
  const now = new Date();
  const passwordHash = await hashPassword(password);

  await db.transaction(async (tx) => {
    await tx.insert(user).values({
      id,
      name: "Health-Bridge Admin",
      email: normalizedEmail,
      role: "admin",
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await tx.insert(account).values({
      id: crypto.randomUUID(),
      accountId: id,
      providerId: "credential",
      userId: id,
      password: passwordHash,
      createdAt: now,
      updatedAt: now,
    });
  });
  console.info("Bootstrap admin created.");
}

async function main() {
  const parsedEnv = bootstrapEnvSchema.safeParse(process.env);
  if (!parsedEnv.success) {
    throw new Error("Set a valid ADMIN_BOOTSTRAP_EMAIL and an ADMIN_BOOTSTRAP_PASSWORD of 16 to 128 characters.");
  }

  await seedDepartments();
  await seedAdmin(parsedEnv.data.ADMIN_BOOTSTRAP_EMAIL, parsedEnv.data.ADMIN_BOOTSTRAP_PASSWORD);
}

main()
  .catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "Phase 2 seed failed.");
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$client.end();
  });
