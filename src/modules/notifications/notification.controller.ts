import type { Request, Response } from "express";
import { addNotificationJob } from "../../services/notifications/notificationQueue.js";
import { ALL_USERS_TOPIC } from "../../services/notifications/topic.service.js";
import type { SendNotificationDto } from "./notification.validators.js";

/**
 * Admin push bildirimi gönderimi. Gönderim kuyruğa alınır (async): HTTP isteği
 * FCM gecikmesine/retry'ına takılmaz, hemen 202 döner.
 */
export const sendNotificationHandler = async (req: Request, res: Response) => {
  const { target, userId, topic, payload } = (req as any).body as SendNotificationDto;

  if (target === "user") {
    // userId, target=user için şemada zorunlu kılınmıştır (refine).
    await addNotificationJob({ type: "user", userId: userId!, payload });
  } else if (target === "topic") {
    // topic, target=topic için şemada zorunlu kılınmıştır (refine).
    await addNotificationJob({ type: "topic", topic: topic!, payload });
  } else {
    await addNotificationJob({ type: "topic", topic: ALL_USERS_TOPIC, payload });
  }

  res.status(202).json({ success: true, queued: true });
};
