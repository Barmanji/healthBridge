import { z } from "zod";

export const patientProfileSchema = z.object({
  name: z.string().trim().min(2, "Name must have at least 2 characters.").max(80, "Name must be 80 characters or fewer."),
});
