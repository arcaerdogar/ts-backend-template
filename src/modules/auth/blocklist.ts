import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";

/**
 * Access token'lar stateless JWT olduğu için anında iptal edilemez. Suspend /
 * delete gibi durumlarda kullanıcıyı bu blocklist'e ekleriz; authGuard her
 * istekte buraya bakar ve engellenmiş kullanıcının mevcut access token'larını
 * reddeder.
 *
 * TTL = access token ömrü: o süre dolduktan sonra zaten geçerli access token
 * kalmaz, dolayısıyla anahtar kendiliğinden temizlenir.
 */
const key = (userId: string) => `blocked:user:${userId}`;
const ttlSeconds = env.jwt.accessExpiresMin * 60;

export const blockUser = (userId: string) =>
  redis.set(key(userId), "1", "EX", ttlSeconds);

export const unblockUser = (userId: string) => redis.del(key(userId));

export const isUserBlocked = async (userId: string): Promise<boolean> =>
  (await redis.exists(key(userId))) === 1;
