import type { AuthEventType, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { logger } from "../../config/logger.js";
import { getRequestId } from "../common/requestContext.js";

export type AuthEventInput = {
  type: AuthEventType;
  userId?: string | null | undefined;
  email?: string | null | undefined;
  jti?: string | null | undefined;
  deviceId?: string | null | undefined;
  ip?: string | null | undefined;
  userAgent?: string | null | undefined;
  meta?: Prisma.InputJsonValue | undefined;
};

/**
 * Tek auth olay çıkış noktası. İki yere yazar:
 *   1) AuthEvent tablosu  → sorgulanabilir, kullanıcı-bazlı geçmiş (otorite)
 *   2) structured log     → operasyonel gözlemlenebilirlik (#21 ile zenginleşir)
 *
 * Best-effort'tur: denetim yazımı asla auth akışını bozmaz (hata yutulur).
 */
export async function recordAuthEvent(e: AuthEventInput): Promise<void> {
  const requestId = getRequestId();

  // Operasyonel log (aynı requestId ile diğer log satırlarına bağlanır).
  logger.info({ kind: "auth_event", requestId, ...e }, "auth_event");

  // requestId'yi meta'ya da koy → audit kaydı ↔ loglar çapraz bağlanır.
  const baseMeta =
    e.meta && typeof e.meta === "object" && !Array.isArray(e.meta)
      ? (e.meta as Record<string, unknown>)
      : {};
  const meta = { ...baseMeta, ...(requestId ? { requestId } : {}) };

  try {
    await prisma.authEvent.create({
      data: {
        type: e.type,
        userId: e.userId ?? null,
        email: e.email ?? null,
        jti: e.jti ?? null,
        deviceId: e.deviceId ?? null,
        ip: e.ip ?? null,
        userAgent: e.userAgent ?? null,
        ...(Object.keys(meta).length ? { meta: meta as Prisma.InputJsonValue } : {}),
      },
    });
  } catch (err) {
    logger.error({ err, requestId }, "Failed to persist auth event");
  }
}
