import { prisma } from "../../config/db.js";
import { randomBytes, randomUUID } from "crypto";
import argon2 from "argon2";
import { env } from "../../config/env.js";
import { HttpError } from "../common/errors.js";

function b64url(buf: Buffer) {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function issueRefreshToken(
  userId: string,
  ua?: string,
  ip?: string,
  deviceId?: string
) {
  const jti = randomUUID();
  if (!deviceId) {
    deviceId = randomUUID();
  }
  const secret = b64url(randomBytes(32));
  const raw = `${jti}.${secret}`;
  const tokenHash = await argon2.hash(raw);

  const expiresAt = new Date(
    Date.now() + env.refresh.expireDays * 24 * 3600 * 1000
  );

  await prisma.refreshToken.create({
    data: {
      userId,
      jti,
      tokenHash,
      userAgent: ua ?? null,
      ip: ip ?? null,
      deviceId: deviceId,
      expiresAt,
    },
  });

  return { raw, jti, expiresAt, deviceId };
}

export async function verifyAndRotate(
  oldRaw: string,
  deviceId: string,
  ua?: string,
  ip?: string
) {
  const [jti, secret] = (oldRaw || "").split(".");
  if (!jti || !secret) throw HttpError.badRequest("Bad token format.");

  return prisma.$transaction(async (tx) => {
    const rec = await tx.refreshToken.findUnique({
      where: { jti },
      select: {
        userId: true,
        tokenHash: true,
        revoked: true,
        expiresAt: true,
        createdAt: true,
        deviceId: true,
      },
    });
    if (!rec) throw HttpError.unauthorized("Invalid session.");
    if (rec.revoked) throw HttpError.unauthorized("Session revoked.");
    if (rec.expiresAt <= new Date())
      throw HttpError.unauthorized("Session expired.");
    if (rec.deviceId !== deviceId)
      throw HttpError.unauthorized("Session device mismatch.");

    const u = await tx.user.findUnique({
      where: { id: rec.userId },
      select: { passwordChangedAt: true },
    });
    if (u?.passwordChangedAt && rec.createdAt < u.passwordChangedAt) {
      await tx.refreshToken.update({ where: { jti }, data: { revoked: true } });
      throw HttpError.unauthorized(
        "You must login again after password change."
      );
    }

    const ok = await argon2.verify(rec.tokenHash, oldRaw);
    if (!ok) {
      await tx.refreshToken.update({ where: { jti }, data: { revoked: true } });
      throw HttpError.unauthorized("Invalid session.");
    }

    const revokeRes = await tx.refreshToken.updateMany({
      where: { jti, revoked: false },
      data: { revoked: true },
    });
    if (revokeRes.count < 1) {
      throw HttpError.badRequest("Session already refreshed.");
    }
    const newJti = randomUUID();
    const secret2 = b64url(randomBytes(32));
    const newRaw = `${newJti}.${secret2}`;
    const tokenHash2 = await argon2.hash(newRaw);
    const expiresAt = new Date(
      Date.now() + env.refresh.expireDays * 24 * 3600 * 1000
    );

    await tx.refreshToken.create({
      data: {
        userId: rec.userId,
        jti: newJti,
        tokenHash: tokenHash2,
        userAgent: ua ?? null,
        ip: ip ?? null,
        deviceId: deviceId,
        expiresAt,
      },
    });

    return { userId: rec.userId, newRaw, newJti, expiresAt };
  });
}

export const revokeActiveTokensForDevice = async (
  userId: string,
  deviceId: string
) => {
  await prisma.refreshToken.updateMany({
    where: { userId, deviceId, revoked: false },
    data: { revoked: true },
  });
};

export async function revokeByRaw(raw: string) {
  const [jti] = (raw || "").split(".");
  if (!jti) return;
  await prisma.refreshToken.updateMany({
    where: { jti },
    data: { revoked: true },
  });
}

export const revokeAll = async (userId: string) => {
  await prisma.refreshToken.updateMany({
    where: { userId },
    data: { revoked: true },
  });
};
