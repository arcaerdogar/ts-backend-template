import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "crypto";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { HttpError } from "../common/errors.js";
import { recordAuthEvent } from "./authEvent.js";
import { ROTATE_SESSION_LUA } from "./refresh.lua.js";

const ttlMs = env.refresh.expireDays * 24 * 3600 * 1000;

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function hashToken(raw: string): string {
  return createHmac("sha256", env.refresh.tokenHashSecret)
    .update(raw)
    .digest("hex");
}

const sessKey = (jti: string) => `sess:${jti}`;
const revokedKey = (jti: string) => `revoked:${jti}`;
const userSessionsKey = (userId: string) => `user:${userId}:sessions`;
const deviceKey = (userId: string, deviceId: string) =>
  `user:${userId}:device:${deviceId}`;

export type SessionInfo = {
  userAgent: string | null;
  ip: string | null;
  deviceId: string;
  createdAt: Date;
  expiresAt: Date;
};

export async function issueRefreshToken(
  userId: string,
  ua?: string,
  ip?: string,
  deviceId?: string
) {
  const jti = randomUUID();
  const dev = deviceId ?? randomUUID();
  const secret = b64url(randomBytes(32));
  const raw = `${jti}.${secret}`;
  const tokenHash = hashToken(raw);

  const now = Date.now();
  const expiresAt = now + ttlMs;

  await redis
    .multi()
    .hset(sessKey(jti), {
      userId,
      tokenHash,
      deviceId: dev,
      userAgent: ua ?? "",
      ip: ip ?? "",
      createdAt: now,
      expiresAt,
    })
    .pexpire(sessKey(jti), ttlMs)
    .zadd(userSessionsKey(userId), expiresAt, jti)
    .set(deviceKey(userId, dev), jti, "PX", ttlMs)
    .exec();

  return { raw, jti, expiresAt: new Date(expiresAt), deviceId: dev };
}

export async function verifyAndRotate(
  oldRaw: string,
  deviceId: string,
  ua?: string,
  ip?: string
) {
  const [oldJti, secret] = (oldRaw || "").split(".");
  if (!oldJti || !secret) throw HttpError.badRequest("Bad token format.");

  const presentedHash = hashToken(oldRaw);
  const newJti = randomUUID();
  const newRaw = `${newJti}.${b64url(randomBytes(32))}`;
  const newHash = hashToken(newRaw);
  const now = Date.now();
  const newExp = now + ttlMs;

  const res = (await redis.eval(
    ROTATE_SESSION_LUA,
    2,
    sessKey(oldJti),
    revokedKey(oldJti),
    presentedHash,
    deviceId,
    String(now),
    newJti,
    newHash,
    String(ttlMs),
    String(newExp),
    ua ?? "",
    ip ?? "",
    oldJti
  )) as [string, string?];

  const status = res[0];
  if (status === "ok") {
    return { userId: res[1]!, newRaw, newJti, expiresAt: new Date(newExp) };
  }
  if (status === "reuse") {
    if (res[1]) {
      await recordAuthEvent({
        type: "REUSE_DETECTED",
        userId: res[1],
        deviceId,
        ip: ip ?? null,
        userAgent: ua ?? null,
      });
    }
    throw HttpError.unauthorized("Invalid session.");
  }
  if (status === "device")
    throw HttpError.unauthorized("Session device mismatch.");
  throw HttpError.unauthorized("Invalid session.");
}

async function revokeOne(userId: string, jti: string) {
  const exp = await redis.hget(sessKey(jti), "expiresAt");
  const remaining = exp ? Math.max(1000, Number(exp) - Date.now()) : ttlMs;
  await redis
    .multi()
    .del(sessKey(jti))
    .zrem(userSessionsKey(userId), jti)
    .set(revokedKey(jti), userId, "PX", remaining)
    .exec();
}

/** Bir cihazın aktif oturumunu iptal eder (login'de tek-aktif-oturum kuralı). */
export const revokeActiveTokensForDevice = async (
  userId: string,
  deviceId: string
) => {
  const jti = await redis.get(deviceKey(userId, deviceId));
  if (jti) {
    await revokeOne(userId, jti);
    await redis.del(deviceKey(userId, deviceId));
  }
};

/** Ham token ile iptal (logout). İptal edilen oturumun userId'sini döner. */
export async function revokeByRaw(raw: string): Promise<string | null> {
  const jti = (raw || "").split(".")[0];
  if (!jti) return null;
  const userId = await redis.hget(sessKey(jti), "userId");
  if (!userId) return null;
  await revokeOne(userId, jti);
  return userId;
}

/** Kullanıcının tüm oturumlarını iptal eder (logout-all / suspend / parola). */
export const revokeAll = async (userId: string) => {
  const jtis = await redis.zrange(userSessionsKey(userId), 0, -1);
  const m = redis.multi();
  for (const jti of jtis) {
    m.del(sessKey(jti));
    m.set(revokedKey(jti), userId, "PX", ttlMs);
  }
  m.del(userSessionsKey(userId));
  await m.exec();
};

/** Kullanıcının aktif oturumlarını listeler (bayat üyeleri okuma anında budar). */
export async function listSessions(userId: string): Promise<SessionInfo[]> {
  const key = userSessionsKey(userId);
  await redis.zremrangebyscore(key, "-inf", Date.now());
  const jtis = await redis.zrange(key, 0, -1);
  if (jtis.length === 0) return [];

  const pipe = redis.pipeline();
  for (const jti of jtis) pipe.hgetall(sessKey(jti));
  const results = await pipe.exec();

  return (results ?? [])
    .map(([, h]) => h as Record<string, string>)
    .filter((h) => h && h.userId)
    .map((h) => ({
      userAgent: h.userAgent || null,
      ip: h.ip || null,
      deviceId: h.deviceId ?? "",
      createdAt: new Date(Number(h.createdAt)),
      expiresAt: new Date(Number(h.expiresAt)),
    }));
}
