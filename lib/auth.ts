import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { Resend } from "resend";
import { db } from "./db";
import * as schema from "./db/schema";
import { signUpSchema } from "@/modules/auth/schemas";

function htmlEscape(value: string) {
  return value.replace(/[&<>"']/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    };
    return entities[character];
  });
}

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: true,
  },
  emailVerification: {
    sendOnSignUp: true,
    autoSignInAfterVerification: false,
    async afterEmailVerification(verifiedUser) {
      if (!("role" in verifiedUser && verifiedUser.role === "doctor")) return;

      await db
        .insert(schema.doctorProfiles)
        .values({ userId: verifiedUser.id })
        .onConflictDoNothing({ target: schema.doctorProfiles.userId });
    },
    async sendVerificationEmail({ user, url }) {
      const apiKey = process.env.RESEND_API_KEY;
      const from = process.env.RESEND_FROM_EMAIL;
      if (!apiKey || !from) {
        throw new Error("Email verification requires RESEND_API_KEY and RESEND_FROM_EMAIL.");
      }

      const verificationUrl = htmlEscape(url);
      const name = htmlEscape(user.name || "there");
      const { error } = await new Resend(apiKey).emails.send({
        from,
        to: user.email,
        subject: "Verify your Health-Bridge email",
        html: `<p>Hello ${name},</p><p>Verify your email to continue creating your Health-Bridge account.</p><p><a href="${verificationUrl}">Verify email address</a></p><p>If you did not request this, you can ignore this email.</p>`,
        text: `Hello ${user.name || "there"},\n\nVerify your Health-Bridge email: ${url}\n\nIf you did not request this, you can ignore this email.`,
      });

      if (error) {
        throw new Error("Resend could not send the verification email.");
      }
    },
  },
  user: {
    additionalFields: {
      role: {
        type: ["patient", "doctor", "admin"],
        required: false,
        defaultValue: "patient",
        input: true,
      },
    },
  },
  hooks: {
    before: createAuthMiddleware(async (context) => {
      if (context.path !== "/sign-up/email") return;

      const parsed = signUpSchema.safeParse(context.body);
      if (!parsed.success) {
        throw new APIError("BAD_REQUEST", {
          message: "Invalid sign-up details.",
        });
      }
    }),
  },
  databaseHooks: {
    user: {
      create: {
        before: async (newUser) => {
          const role = "role" in newUser ? newUser.role : undefined;
          if (role && role !== "patient" && role !== "doctor") {
            throw new APIError("FORBIDDEN", { message: "That account role cannot be assigned during sign-up." });
          }
        },
      },
      update: {
        before: async (updatedUser) => {
          if (Object.hasOwn(updatedUser, "role")) {
            throw new APIError("FORBIDDEN", { message: "Account roles cannot be changed through profile updates." });
          }
        },
      },
    },
  },
});
