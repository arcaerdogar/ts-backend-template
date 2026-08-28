import type { FcmPlatform } from "@prisma/client";

/**
 * FCM mesajı oluşturmak için dahili bildirim payload'ı.
 */
export interface NotificationPayload {
  title: string;
  body?: string | undefined;
  /** FCM data mesajı: değerler string olmalı (FCM kısıtı). */
  data?: Record<string, string> | undefined;
}

/**
 * FCM token kayıt girdisi (HTTP body'sinden gelir).
 */
export interface FcmTokenRegistrationInput {
  token: string;
  deviceId: string;
  platform: FcmPlatform;
}

/**
 * Gönderim yanıtını işlemek için DB id'li token kaydı
 * (başarı → lastUsedAt, geçersiz → isActive=false).
 */
export interface FcmTokenRecord {
  id: string;
  token: string;
  userId: string;
  deviceId: string;
}

export { type FcmPlatform };
