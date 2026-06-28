import { Worker, Job, UnrecoverableError } from "bullmq";
import { env } from "../../config/env.js";
import { Redis as IORedis } from "ioredis";
import { type BulkEmailJob, addBulkEmailJob } from "./bulkmailService.js";
import { sendEmail } from "./aws.ses.js";
import { renderTemplate } from "./templates/template.loader.js";
import { logger } from "../../config/logger.js";

const connection = new IORedis(env.redis.url, {
  maxRetriesPerRequest: null,
});

const SES_ERROR_CATEGORIES = {
  // Yeniden denenebilir (Requeue)
  RETRYABLE: [
    "Throttling",
    "ThrottlingException",
    "RequestTimeout",
    "ServiceUnavailable",
    "InternalFailure",
    "TooManyRequestsException",
    "ECONNRESET",
    "ETIMEDOUT",
    "TransientFailure", // Added SES specific status
  ],
  // Kullanıcıyı kara listeye al (Blacklist)
  BLACKLIST: [
    "InvalidParameterValue", // E-posta formatı bozuk
    "MessageRejected", // İçerik veya domain reddedildi
    "AccountThrottled", // Bu genellikle kalıcı bir sınıra takıldığını gösterir
    "MailboxUnavailable", // Bazen kalıcı olabilir, duruma göre
    "ConfigurationSetSendingPaused",
    "AccountSendingPaused",
  ],
  // Kod/Sistem hatası (Fatal - Kuyruğu durdur veya logla)
  FATAL: [
    "TemplateDoesNotExist",
    "AccessDeniedException",
    "ConfigurationSetDoesNotExist",
    "InvalidRenderingParameterException",
    "MissingCustomVerificationEmailTemplateException",
  ],
};

function getErrorCategory(
  errorName: string,
): "RETRYABLE" | "BLACKLIST" | "FATAL" | "UNKNOWN" {
  if (SES_ERROR_CATEGORIES.RETRYABLE.includes(errorName)) return "RETRYABLE";
  if (SES_ERROR_CATEGORIES.BLACKLIST.includes(errorName)) return "BLACKLIST";
  if (SES_ERROR_CATEGORIES.FATAL.includes(errorName)) return "FATAL";
  return "UNKNOWN";
}

export const emailWorker = new Worker<BulkEmailJob>(
  "bulk-mail",
  async (job: Job<BulkEmailJob>) => {
    const { templateName, subject, destinations, from, replyTo } = job.data;

    const retryDestinations: typeof destinations = [];

    // Process all destinations in the batch concurrently
    await Promise.all(
      destinations.map(async (d) => {
        try {
          // 1. Render locally
          const html = renderTemplate(templateName, d.templateData || {});

          // 2. Send Email
          await sendEmail({
            to: d.destination,
            subject,
            html,
            from: from || env.aws.ses.senderEmail,
            ...(replyTo ? { replyTo } : {}),
          });

          logger.info({ to: d.destination }, "Email sent");
        } catch (error: any) {
          // Error handling logic
          const errorName = error.name || error.code || "Unknown";
          const category = getErrorCategory(errorName);

          logger.error(
            { to: d.destination, errorName, category, err: error },
            "Email send failed",
          );

          if (category === "RETRYABLE") {
            retryDestinations.push(d);
          } else if (category === "BLACKLIST") {
            // already logged above with category
          } else if (category === "FATAL") {
            // already logged above with category
          } else {
            // Unknown -> Alert Admin

            if (env.admin?.email) {
              await sendEmail({
                to: env.admin.email,
                subject: `System Error: Sending ${templateName} Email Error (${errorName})`,
                html: `<p>An ${category} error occurred while sending email to <strong>${d.destination}</strong>.</p>
                       <p><strong>Error Type:</strong> ${errorName}</p>
                       <p><strong>Original Error:</strong> ${JSON.stringify(error)}</p>`,
                from: from || env.aws.ses.senderEmail,
              });
            }
          }
        }
      }),
    );

    if (retryDestinations.length > 0) {
      await addBulkEmailJob(templateName, subject, retryDestinations, {
        ...(from ? { from } : {}),
        ...(replyTo ? { replyTo } : {}),
      });
      logger.info({ count: retryDestinations.length }, "Re-queued emails");
    }
  },
  {
    connection,
    limiter: {
      max: 1,
      duration: 1000,
    },
    concurrency: 1,
  },
);

emailWorker.on("completed", (job) => {
  logger.info({ jobId: job.id }, "Job completed");
});

emailWorker.on("failed", (job, err) => {
  logger.error({ jobId: job?.id, err }, "Job failed");
});
