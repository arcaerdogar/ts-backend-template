import { Redis as IORedis } from "ioredis";
import { env } from "./env.js";
import { logger } from "./logger.js";

/**
 * Uygulamanın genel amaçlı paylaşılan Redis bağlantısı (rate limiter, 2FA
 * denylist, session store vb.). BullMQ Worker'ları bloklayan komutlar
 * kullandığı için kendi ayrı bağlantılarını korur.
 */
export const redis = new IORedis(env.redis.url, {
  maxRetriesPerRequest: null,
});

// 'error' listener'ı şart: aksi halde ioredis'in yaydığı hata "unhandled
// error event" olarak süreci çökertebilir.
redis.on("error", (err) => logger.error({ err }, "Redis connection error"));
redis.on("connect", () => logger.info("Redis connected"));
redis.on("reconnecting", () => logger.warn("Redis reconnecting"));
