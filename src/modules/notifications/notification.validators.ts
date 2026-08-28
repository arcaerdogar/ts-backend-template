import { z } from "zod";

// Push gönderim payload'ı. FCM data mesajında değerler string olmak zorundadır.
const payloadSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().max(1000).optional(),
  data: z.record(z.string(), z.string()).optional(),
});

/**
 * Admin gönderim isteği. Hedefe göre alanlar:
 *  - target=user  -> userId zorunlu
 *  - target=topic -> topic zorunlu
 *  - target=all   -> ek alan yok (all-users topic'ine broadcast)
 */
export const sendNotificationSchema = z
  .object({
    target: z.enum(["user", "topic", "all"]),
    userId: z.uuid().optional(),
    topic: z.string().min(1).max(200).optional(),
    payload: payloadSchema,
  })
  .refine((d) => d.target !== "user" || !!d.userId, {
    message: "userId is required when target is 'user'.",
    path: ["userId"],
  })
  .refine((d) => d.target !== "topic" || !!d.topic, {
    message: "topic is required when target is 'topic'.",
    path: ["topic"],
  });

export type SendNotificationDto = z.infer<typeof sendNotificationSchema>;
