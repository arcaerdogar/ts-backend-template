import type { AuthEventType, Prisma } from "@prisma/client";
import { prisma } from "../../config/db.js";

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
  // #21 geldiğinde burası pino + request/correlation ID ile değişecek.
  console.log(
    JSON.stringify({ kind: "auth_event", ts: new Date().toISOString(), ...e })
  );

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
        ...(e.meta !== undefined ? { meta: e.meta } : {}),
      },
    });
  } catch (err) {
    console.error("Failed to persist auth event:", err);
  }
}
