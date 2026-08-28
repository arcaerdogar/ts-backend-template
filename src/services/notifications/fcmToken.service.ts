import { prisma } from "../../config/db.js";
import { getMessaging } from "./firebase.config.js";
import { isFirebaseConfigured } from "./firebase.config.js";
import { onTokenRefresh } from "./topic.service.js";
import { HttpError } from "../../modules/common/errors.js";
import type { FcmTokenRegistrationInput } from "./notification.types.js";

/**
 * Token'ı Firebase ile doğrular (validateOnly / dry-run gönderim). FCM
 * yapılandırılmamışsa veya test ortamındaysak sahte token'lara izin vermek için
 * doğrulamayı atlar.
 */
async function validateToken(token: string): Promise<boolean> {
  if (!isFirebaseConfigured() || process.env.NODE_ENV === "test") return true;

  try {
    const messaging = getMessaging();
    await messaging.send(
      {
        token,
        notification: { title: "validate", body: "" },
      },
      true
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * FCM token'ı kaydeder veya günceller. Önce doğrular; yalnızca geçerliyse yazar.
 * Kullanıcı+cihaz başına tek satır (userId+deviceId UNIQUE) — aynı cihazdan yeni
 * token gelirse mevcut satır güncellenir ve yeniden aktifleştirilir.
 */
export async function registerFcmToken(
  userId: string,
  input: FcmTokenRegistrationInput
): Promise<{ created: boolean }> {
  const isValid = await validateToken(input.token);
  if (!isValid) {
    throw HttpError.badRequest("Invalid FCM token");
  }

  const existing = await prisma.fcmToken.findUnique({
    where: {
      userId_deviceId: { userId, deviceId: input.deviceId },
    },
  });

  if (existing) {
    await prisma.fcmToken.update({
      where: { id: existing.id },
      data: {
        token: input.token,
        platform: input.platform,
        isActive: true,
      },
    });
  } else {
    await prisma.fcmToken.create({
      data: {
        userId,
        token: input.token,
        deviceId: input.deviceId,
        platform: input.platform,
      },
    });
  }

  // Cihazı varsayılan broadcast topic'ine (all-users) abone et.
  await onTokenRefresh(userId, input.token);

  return { created: !existing };
}

/**
 * Belirli bir cihazın FCM token'ını pasifleştirir (logout).
 */
export async function deactivateFcmTokenForDevice(
  userId: string,
  deviceId: string
): Promise<void> {
  await prisma.fcmToken.updateMany({
    where: { userId, deviceId },
    data: { isActive: false },
  });
}

/**
 * Kullanıcının tüm FCM token'larını pasifleştirir (logout-all / suspend).
 */
export async function deactivateAllFcmTokensForUser(
  userId: string
): Promise<void> {
  await prisma.fcmToken.updateMany({
    where: { userId },
    data: { isActive: false },
  });
}
