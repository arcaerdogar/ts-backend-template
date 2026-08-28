import { prisma } from "../../config/db.js";
import { getMessaging } from "./firebase.config.js";
import { isFirebaseConfigured } from "./firebase.config.js";
import {
  processMulticastResponse,
  chunkTokens,
} from "./notification.handlers.js";
import { addNotificationJob } from "./notificationQueue.js";
import { logger } from "../../config/logger.js";
import { ALL_USERS_TOPIC } from "./topic.service.js";
import type {
  NotificationPayload,
  FcmTokenRecord,
} from "./notification.types.js";

const log = logger.child({ module: "notification" });

/**
 * Tek bir kullanıcının tüm aktif cihazlarına gönderir. FCM yapılandırılmamışsa
 * veya kullanıcının aktif token'ı yoksa sessizce döner.
 */
export async function sendToUser(
  userId: string,
  payload: NotificationPayload
): Promise<void> {
  if (!isFirebaseConfigured()) return;

  const tokens = await prisma.fcmToken.findMany({
    where: { userId, isActive: true },
    select: { id: true, token: true, userId: true, deviceId: true },
  });
  if (tokens.length === 0) return;

  await sendToTokens(tokens, payload);
}

/**
 * Bir topic'e gönderir (segment / broadcast).
 */
export async function sendToTopic(
  topic: string,
  payload: NotificationPayload
): Promise<void> {
  if (!isFirebaseConfigured()) return;

  const messaging = getMessaging();
  const message = {
    topic,
    notification: {
      title: payload.title,
      body: payload.body ?? "",
    },
    data: payload.data ?? {},
  };

  try {
    await messaging.send(message);
  } catch (err) {
    log.error({ topic, err }, "sendToTopic failed");
    throw err;
  }
}

/**
 * Tüm kullanıcılara gönderir (all-users topic'i üzerinden broadcast).
 */
export async function sendToAll(payload: NotificationPayload): Promise<void> {
  return sendToTopic(ALL_USERS_TOPIC, payload);
}

/**
 * Dahili: belirli token'lara sendEachForMulticast ile gönderir, yanıtı işler.
 * Geçici hata alan token'lar için işi kuyruğa geri koyar (retry).
 */
async function sendToTokens(
  tokenRecords: FcmTokenRecord[],
  payload: NotificationPayload
): Promise<void> {
  if (tokenRecords.length === 0) return;

  const messaging = getMessaging();
  const chunks = chunkTokens(tokenRecords);

  for (const chunk of chunks) {
    const tokens = chunk.map((r) => r.token);
    const multicastMessage = {
      tokens,
      notification: {
        title: payload.title,
        body: payload.body ?? "",
      },
      data: payload.data ?? {},
    };

    try {
      const response = await messaging.sendEachForMulticast(multicastMessage);
      const { retryRecords } = await processMulticastResponse(response, chunk);

      if (retryRecords.length > 0) {
        const userId = chunk[0]?.userId;
        if (userId) {
          await addNotificationJob({
            type: "user",
            userId,
            payload,
          });
        }
      }
    } catch (err) {
      log.error({ err }, "sendEachForMulticast failed");
      throw err;
    }
  }
}
