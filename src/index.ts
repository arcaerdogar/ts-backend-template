import { env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { emailWorker } from "./services/mail-service/emailWorker.js";
import { notificationWorker } from "./services/notifications/notificationWorker.js";
import { prisma } from "./config/db.js";
import server from "./server.js";

const port = env.port || 3000;

const httpServer = server.listen(port, () => {
  logger.info({ port }, "Server is running");
});

const shutdown = async () => {
  logger.info("Shutdown started");

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await emailWorker.close();
  await notificationWorker.close();
  await prisma.$disconnect();

  logger.info("Shutdown complete");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

process.on("unhandledRejection", (reason) => {
  logger.error({ reason }, "Unhandled promise rejection");
});

process.on("uncaughtException", (err) => {
  logger.fatal({ err }, "Uncaught exception, shutting down");
  process.exit(1);
});
