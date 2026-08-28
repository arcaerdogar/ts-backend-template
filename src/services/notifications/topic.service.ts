import { prisma } from "../../config/db.js";
import { getMessaging } from "./firebase.config.js";
import { isFirebaseConfigured } from "./firebase.config.js";
import { logger } from "../../config/logger.js";

const log = logger.child({ module: "topic" });

/**
 * FCM topic'leri. `ALL_USERS_TOPIC` broadcast (sendToAll) için kullanılır; token
 * kaydında her cihaz otomatik bu topic'e abone edilir.
 *
 * Not: Bu bir template. Referans projede topic'ler domain'e özgü segmentlere
 * ("trace-*") bağlıydı; burada sadece generic bir "all-users" broadcast'i ve
 * yeniden kullanılabilir subscribe/unsubscribe helper'ları bırakıldı. Kendi
 * segment topic'lerinizi (ör. "role-admin", "region-tr") subscribeTokensToTopic
 * ile token kaydı/rol değişimi anında yönetebilirsiniz.
 */
export const ALL_USERS_TOPIC = "all-users";

/** Verilen token'ları bir topic'e abone eder (best-effort; hata loglanır). */
export async function subscribeTokensToTopic(
  tokens: string[],
  topic: string
): Promise<void> {
  if (!isFirebaseConfigured() || tokens.length === 0) return;
  try {
    await getMessaging().subscribeToTopic(tokens, topic);
  } catch (err) {
    log.warn({ topic, err }, "subscribe failed");
  }
}

/** Verilen token'ları bir topic'ten çıkarır (best-effort; hata loglanır). */
export async function unsubscribeTokensFromTopic(
  tokens: string[],
  topic: string
): Promise<void> {
  if (!isFirebaseConfigured() || tokens.length === 0) return;
  try {
    await getMessaging().unsubscribeFromTopic(tokens, topic);
  } catch (err) {
    log.warn({ topic, err }, "unsubscribe failed");
  }
}

/**
 * Bir token yeni kaydedildiğinde/yenilendiğinde çağrılır: cihazı varsayılan
 * broadcast topic'ine (all-users) abone eder. Böylece sendToAll o cihaza da
 * ulaşır. Segment topic'leri olan projeler burada kullanıcının topic'lerini de
 * abone edebilir.
 */
export async function onTokenRefresh(
  userId: string,
  newToken: string
): Promise<void> {
  if (!isFirebaseConfigured()) return;
  // userId ileride kullanıcıya özel segment topic'leri için imzada tutuluyor.
  void userId;
  await subscribeTokensToTopic([newToken], ALL_USERS_TOPIC);
}

/**
 * Kullanıcının tüm aktif token'larını verilen topic'e abone eder. Rol/segment
 * değişiminde çağırmak için pratik bir helper.
 */
export async function subscribeUserToTopic(
  userId: string,
  topic: string
): Promise<void> {
  if (!isFirebaseConfigured()) return;
  const tokens = await prisma.fcmToken.findMany({
    where: { userId, isActive: true },
    select: { token: true },
  });
  await subscribeTokensToTopic(
    tokens.map((t) => t.token),
    topic
  );
}
