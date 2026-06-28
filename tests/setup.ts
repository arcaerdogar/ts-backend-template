// Env'i en önce yükle: src/config/env.ts import edilince .env yerine bu
// değerlerin geçerli olması gerekir.
import dotenv from "dotenv";
dotenv.config({ path: ".env.test", override: true });

import { afterAll, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import { SESClient, SendEmailCommand } from "@aws-sdk/client-ses";
import { Redis as IORedis } from "ioredis";
import { prisma } from "../src/config/db.js";

// Tüm SESClient.send çağrılarını yakala -> gerçek mail gönderilmez.
export const sesMock = mockClient(SESClient);

// Rate limiter'ın kullandığı test Redis'ini temizlemek için ayrı bağlantı.
const redis = new IORedis(process.env.REDIS_URL!, {
  maxRetriesPerRequest: null,
});

const TABLES = [
  '"HasRole"',
  '"RefreshToken"',
  '"ExpiredTwoFactorToken"',
  '"File"',
  '"User"',
];

beforeEach(async () => {
  sesMock.reset();
  sesMock.on(SendEmailCommand).resolves({ MessageId: "test-message-id" });

  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${TABLES.join(", ")} RESTART IDENTITY CASCADE;`
  );
  await redis.flushdb();
});

afterAll(async () => {
  await prisma.$disconnect();
  await redis.quit();
});
