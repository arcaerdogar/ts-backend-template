import { Redis as IORedis } from "ioredis";
import { env } from "./env.js";

/**
 * Uygulamanın genel amaçlı paylaşılan Redis bağlantısı (rate limiter, 2FA
 * denylist, session store vb.). BullMQ Worker'ları bloklayan komutlar
 * kullandığı için kendi ayrı bağlantılarını korur.
 */
export const redis = new IORedis(env.redis.url, {
  maxRetriesPerRequest: null,
});
