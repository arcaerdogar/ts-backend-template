import { prisma } from "../../config/db.js";
import type { FcmTokenRecord } from "./notification.types.js";

/** sendEachForMulticast yanıtındaki tek bir sonuç. */
interface MulticastResponseItem {
  success: boolean;
  error?: { code?: string };
}

interface BatchResponseLike {
  responses: MulticastResponseItem[];
}

// Token artık geçerli değil -> DB'de pasifleştir (isActive=false).
const INVALID_TOKEN_CODES = [
  "messaging/invalid-registration-token",
  "messaging/registration-token-not-registered",
];

// Geçici FCM hatası -> yeniden dene (retry kuyruğuna al).
const RETRY_CODES = ["messaging/quota-exceeded", "messaging/unavailable"];

/** FCM multicast tek istekte en fazla 500 token kabul eder. */
export const FCM_BATCH_SIZE = 500;

/**
 * sendEachForMulticast yanıtını işler: başarılı token'larda lastUsedAt günceller,
 * geçersiz token'ları isActive=false yapar, geçici hata alanları retry için döner.
 */
export async function processMulticastResponse(
  response: BatchResponseLike,
  tokenRecords: FcmTokenRecord[]
): Promise<{ retryRecords: FcmTokenRecord[] }> {
  const retryRecords: FcmTokenRecord[] = [];
  const now = new Date();

  for (let i = 0; i < response.responses.length; i++) {
    const r = response.responses[i];
    const record = tokenRecords[i];
    if (!record || !r) continue;

    if (r.success) {
      await prisma.fcmToken.update({
        where: { id: record.id },
        data: { lastUsedAt: now },
      });
      continue;
    }

    const code = r.error?.code ?? "";
    if (INVALID_TOKEN_CODES.includes(code)) {
      await prisma.fcmToken.update({
        where: { id: record.id },
        data: { isActive: false },
      });
    } else if (RETRY_CODES.includes(code)) {
      retryRecords.push(record);
    }
  }

  return { retryRecords };
}

/**
 * Token'ları en fazla 500'lük gruplara böler (FCM limiti).
 */
export function chunkTokens<T>(items: T[], size = FCM_BATCH_SIZE): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}
