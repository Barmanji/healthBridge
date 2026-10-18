import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { db } from "./db";
import * as schema from "./db/schema";
import { signUpSchema } from "@/modules/auth/schemas";

export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg",
    schema,
  }),
  emailAndPassword: {
    enabled: true,
  },
  user: {
    additionalFields: {
      role: {
        type: ["patient", "doctor"],
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
});
