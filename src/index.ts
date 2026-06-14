import { env } from "./config/env.js";
import { emailWorker } from "./services/mail-service/emailWorker.js";
import { prisma } from "./config/db.js";
import server from "./server.js";

const port = env.port || 3000;

const httpServer = server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});

const shutdown = async () => {
  console.log("Shutdown started...");

  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
  await emailWorker.close();
  await prisma.$disconnect();

  console.log("Shutdown complete.");
  process.exit(0);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
