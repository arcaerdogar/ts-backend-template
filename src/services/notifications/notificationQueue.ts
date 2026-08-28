import { Queue } from "bullmq";
import { Redis } from "ioredis";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { NotificationPayload } from "./notification.types.js";

const connection = new Redis(env.redis.url, {
  maxRetriesPerRequest: null,
});
connection.on("error", (err) =>
  logger.error({ err }, "Redis (notification queue) connection error"),
);

/**
 * Push bildirimi işi. `user` tipi kullanıcının aktif token'larına, `topic` tipi
 * bir FCM topic'ine gönderir. Servis katmanı geçici FCM hatalarında (quota /
 * unavailable) işi bu kuyruğa geri koyar; kuyruğun exponential backoff'u devreye
 * girer.
 */
export interface NotificationJob {
  type: "user" | "topic";
  userId?: string;
  topic?: string;
  payload: NotificationPayload;
}

export const notificationQueue = new Queue<NotificationJob>(
  "push-notifications",
  {
    connection,
    defaultJobOptions: {
      attempts: 5,
      backoff: {
        type: "exponential",
        delay: 2000,
      },
      removeOnComplete: true,
    },
  },
);

export async function addNotificationJob(job: NotificationJob) {
  return notificationQueue.add("send", job);
}
