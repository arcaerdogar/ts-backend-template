import { z } from "zod";

export const updateProfileSchema = z
  .object({
    firstName: z.string().trim().min(1).optional(),
    lastName: z.string().trim().min(1).optional(),
  })
  .refine((d) => d.firstName !== undefined || d.lastName !== undefined, {
    message: "At least one of firstName or lastName is required.",
  });

export const setProfilePhotoSchema = z.object({
  fileId: z.uuid(),
});
