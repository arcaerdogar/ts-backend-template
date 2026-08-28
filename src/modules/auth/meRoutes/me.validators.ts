import { z } from "zod";
import { FcmPlatform } from "@prisma/client";

// Push bildirimi için cihazın FCM kayıt token'ı. deviceId, oturum (refresh)
// akışındaki deviceId ile aynıdır (uuid).
export const fcmTokenRegistrationSchema = z.object({
  token: z.string().min(1),
  deviceId: z.uuid(),
  platform: z.enum(FcmPlatform),
});

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
