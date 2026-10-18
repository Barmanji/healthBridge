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
    // Explicitly send from the signup flow so send errors reach the client and
    // repeated signup attempts can resend to an existing unverified account.
    sendOnSignUp: false,
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
      const greetingName = user.name || "there";
      const subject = "Verify your Health-Bridge email";
      const { error } = await new Resend(apiKey).emails.send({
        from,
        to: user.email,
        subject,
        html: `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${subject}</title></head><body style="margin:0;background:#f3f8f6;color:#173a35;font-family:Arial,Helvetica,sans-serif"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f3f8f6;padding:36px 16px"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:560px;background:#ffffff;border:1px solid #dce9e5;border-radius:20px;overflow:hidden"><tr><td style="background:#155e53;padding:24px 32px;color:#ffffff"><table role="presentation" cellspacing="0" cellpadding="0"><tr><td style="width:38px;height:38px;border-radius:12px;background:#ffffff;color:#155e53;text-align:center;vertical-align:middle;font-size:26px;font-weight:bold">+</td><td style="padding-left:12px;font-size:18px;font-weight:bold;letter-spacing:-.3px">health<span style="color:#bde7dc">bridge</span></td></tr></table></td></tr><tr><td style="padding:36px 32px 32px"><p style="margin:0 0 10px;color:#28796c;font-size:12px;font-weight:bold;letter-spacing:1.2px;text-transform:uppercase">One quick step</p><h1 style="margin:0 0 18px;color:#173a35;font-size:27px;line-height:1.25">Verify your email</h1><p style="margin:0 0 14px;font-size:16px;line-height:1.65">Hello ${name},</p><p style="margin:0 0 26px;color:#526b66;font-size:15px;line-height:1.7">Confirm this email address to continue with your Health-Bridge account. This helps us keep your account and care information protected.</p><table role="presentation" cellspacing="0" cellpadding="0"><tr><td align="center" style="border-radius:999px;background:#155e53"><a href="${verificationUrl}" style="display:inline-block;padding:14px 24px;color:#ffffff;font-size:15px;font-weight:bold;text-decoration:none">Verify email address</a></td></tr></table><p style="margin:24px 0 0;color:#71847f;font-size:13px;line-height:1.6">If the button does not work, copy this link into your browser:<br><a href="${verificationUrl}" style="color:#28796c;word-break:break-all">${verificationUrl}</a></p></td></tr><tr><td style="border-top:1px solid #e7efec;padding:20px 32px;color:#71847f;font-size:12px;line-height:1.6">If you did not create a Health-Bridge account, you can ignore this email.<br><span style="color:#28796c;font-weight:bold">Care that starts with being understood.</span></td></tr></table></td></tr></table></body></html>`,
        text: `Hello ${greetingName},\n\nVerify your email address to continue with your Health-Bridge account:\n${url}\n\nIf you did not create a Health-Bridge account, you can ignore this email.\n\nCare that starts with being understood.`,
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
