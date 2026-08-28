import { Worker, Job } from "bullmq";
import { Redis as IORedis } from "ioredis";
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { NotificationJob } from "./notificationQueue.js";
import { sendToUser, sendToTopic } from "./notification.service.js";

const connection = new IORedis(env.redis.url, {
  maxRetriesPerRequest: null,
});
connection.on("error", (err) =>
  logger.error({ err }, "Redis (notification worker) connection error"),
);

const log = logger.child({ worker: "notification" });

export const notificationWorker = new Worker<NotificationJob>(
  "push-notifications",
  async (job: Job<NotificationJob>) => {
    const { type, userId, topic, payload } = job.data;

    if (type === "user" && userId) {
      await sendToUser(userId, payload);
    } else if (type === "topic" && topic) {
      await sendToTopic(topic, payload);
    } else {
      log.warn({ jobId: job.id, jobData: job.data }, "invalid job data");
    }
  },
  {
    connection,
    concurrency: 3,
    lockDuration: 60_000,
    stalledInterval: 30_000,
    maxStalledCount: 2,
  },
);

notificationWorker.on("completed", (job) => {
  log.info({ jobId: job.id }, "Notification job completed");
});

notificationWorker.on("failed", (job, err) => {
  log.error({ jobId: job?.id, err, jobData: job?.data }, "Notification job failed");
});

notificationWorker.on("error", (err) => {
  log.error({ err }, "Notification worker error");
});
