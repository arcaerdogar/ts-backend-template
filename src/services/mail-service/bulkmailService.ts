import { Queue } from "bullmq";
import { env } from "../../config/env.js";
import { Redis } from "ioredis";

const connection = new Redis(env.redis.url, {
  maxRetriesPerRequest: null,
});

export const MAX_BULK_SIZE = 14;

export interface BulkEmailJob {
  templateName: string;
  subject: string;
  destinations: Array<{
    destination: string;
    templateData?: Record<string, any>;
  }>;
  from?: string;
  replyTo?: string;
}

export const bulkMailQueue = new Queue<BulkEmailJob>("bulk-mail", {
  connection,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: "exponential",
      delay: 1000,
    },
    removeOnComplete: true,
  },
});

/**
 * Adds bulk email jobs to the queue. Auto-chunks into groups of 14.
 */
export const addBulkEmailJob = async (
  templateName: string,
  subject: string,
  destinations: Array<{
    destination: string;
    templateData?: Record<string, any>;
  }>,
  options: { from?: string; replyTo?: string } = {},
) => {
  const jobs = [];

  for (let i = 0; i < destinations.length; i += MAX_BULK_SIZE) {
    const chunk = destinations.slice(i, i + MAX_BULK_SIZE);
    jobs.push({
      name: "send-bulk-email",
      data: {
        templateName,
        subject,
        destinations: chunk,
        ...(options.from ? { from: options.from } : {}),
        ...(options.replyTo ? { replyTo: options.replyTo } : {}),
      },
    });
  }

  return bulkMailQueue.addBulk(jobs);
};
