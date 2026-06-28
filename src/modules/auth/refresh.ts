import { randomBytes, randomUUID, createHmac, timingSafeEqual } from "crypto";
import { redis } from "../../config/redis.js";
import { env } from "../../config/env.js";
import { HttpError } from "../common/errors.js";
import { recordAuthEvent } from "./authEvent.js";

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

/**
 * Atomik refresh rotation + reuse-detection. Lua, Redis tarafında tek parça
 * çalıştığı için "tam bir kez döndür" garantisi sağlanır ve eşzamanlı
 * yarışlar kapanır.
 *
 * Dönüş (ilk eleman durum kodu):
 *   {"ok", userId} | {"reuse", userId} | {"invalid"} | {"device"}
 */
const ROTATE_LUA = `
local sessK = KEYS[1]
local revK = KEYS[2]
local presentedHash = ARGV[1]
local deviceId = ARGV[2]
local now = tonumber(ARGV[3])
local newJti = ARGV[4]
local newHash = ARGV[5]
local ttl = tonumber(ARGV[6])
local newExp = tonumber(ARGV[7])
local ua = ARGV[8]
local ip = ARGV[9]
local oldJti = ARGV[10]

-- reuse: revoke edilmiş bir jti tekrar sunuldu -> tüm aileyi düşür
local ru = redis.call('GET', revK)
if ru then
  local sessions = redis.call('ZRANGE', 'user:'..ru..':sessions', 0, -1)
  for i=1,#sessions do
    redis.call('DEL', 'sess:'..sessions[i])
    redis.call('SET', 'revoked:'..sessions[i], ru, 'PX', ttl)
  end
  redis.call('DEL', 'user:'..ru..':sessions')
  return {'reuse', ru}
end

if redis.call('EXISTS', sessK) == 0 then return {'invalid'} end
local data = redis.call('HGETALL', sessK)
local h = {}
for i=1,#data,2 do h[data[i]] = data[i+1] end
if h['deviceId'] ~= deviceId then return {'device'} end
if h['tokenHash'] ~= presentedHash then return {'invalid'} end
local userId = h['userId']

redis.call('DEL', sessK)
redis.call('ZREM', 'user:'..userId..':sessions', oldJti)
local remaining = tonumber(h['expiresAt']) - now
if remaining < 1000 then remaining = 1000 end
redis.call('SET', revK, userId, 'PX', remaining)

local newSessK = 'sess:'..newJti
redis.call('HSET', newSessK, 'userId', userId, 'tokenHash', newHash, 'deviceId', deviceId, 'userAgent', ua, 'ip', ip, 'createdAt', now, 'expiresAt', newExp)
redis.call('PEXPIRE', newSessK, ttl)
redis.call('ZADD', 'user:'..userId..':sessions', newExp, newJti)
redis.call('SET', 'user:'..userId..':device:'..deviceId, newJti, 'PX', ttl)
return {'ok', userId}
`;

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
    ROTATE_LUA,
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
