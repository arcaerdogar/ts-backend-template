/**
 * Atomik refresh rotation + reuse-detection için Lua script.
 *
 * Lua, Redis tarafında tek parça (atomik) çalıştığı için "tam bir kez döndür"
 * garantisi sağlanır ve eşzamanlı yarışlar kapanır.
 *
 *   KEYS[1] = sess:<oldJti>
 *   KEYS[2] = revoked:<oldJti>
 *   ARGV    = presentedHash, deviceId, now, newJti, newHash, ttlMs,
 *             newExpiresAt, userAgent, ip, oldJti
 *
 * Dönüş (ilk eleman durum kodu):
 *   {"ok", userId} | {"reuse", userId} | {"invalid"} | {"device"}
 *
 * NOT: Anahtar önekleri (sess:, revoked:, user:<id>:sessions, user:<id>:device:)
 * refresh.ts'teki yardımcılarla aynı kalmalıdır.
 */
export const ROTATE_SESSION_LUA = `
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
