import { createHash } from "crypto";
import { redis } from "../../config/redis.js";

const keyFor = (token: string) =>
  `2fa:used:${createHash("sha256").update(token).digest("hex")}`;

/**
 * Bir 2FA token'ını tek-kullanımlık olarak "tüketmeye" çalışır.
 *
 * Redis `SET ... NX EX` ile atomik check-and-set yapar:
 * - İlk kez tüketiliyorsa anahtar set edilir ve `true` döner.
 * - Daha önce tüketilmişse `null` gelir ve `false` döner (token kullanılmış).
 *
 * Anahtar, token'ın `exp`'i kadar yaşar; TTL ile otomatik silinir.
 *
 * @param exp Token'ın saniye cinsinden son kullanma zamanı (JWT `exp`).
 */
export async function claimTwoFactorToken(
  token: string,
  exp: number
): Promise<boolean> {
  const ttlSeconds = Math.max(1, exp - Math.floor(Date.now() / 1000));
  const result = await redis.set(keyFor(token), "1", "EX", ttlSeconds, "NX");
  return result === "OK";
}
