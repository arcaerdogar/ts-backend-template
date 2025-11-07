import type { NextFunction, Request, Response } from "express";
import { createUser, verifyUser } from "./users.service.js";
import { signAccessToken } from "./jwt.js";
import {
  issueRefreshToken,
  verifyAndRotate,
  revokeActiveTokensForDevice,
  revokeByRaw,
  revokeAll,
} from "./refresh.js";
import { HttpError } from "../common/errors.js";
import MailSender from "../../services/mail-service/mailService.js";

// deviceId ve refreshToken'ı direkt response body'sinde göndererek çözeceğiz. Mobilde cookie yok.

export const register = async (req: Request, res: Response) => {
  const emailRaw = (req as any).body.email;
  const passwordRaw = (req as any).body.password;
  const { id, email } = await createUser(emailRaw, passwordRaw);
  const accessToken = signAccessToken(id);
  const { raw, deviceId } = await issueRefreshToken(
    id,
    req.headers["user-agent"],
    req.ip
  );
  res.status(201).json({
    user: { id, email },
    access: accessToken,
    session: {
      refreshToken: raw,
      deviceId,
      userAgent: req.headers["user-agent"],
      ip: req.ip,
    },
  });
};

export const login = async (req: Request, res: Response) => {
  const { email, password, deviceId } = (req as any).body;
  const user = await verifyUser(email, password);
  const accessToken = signAccessToken(user.id);
  if (deviceId) revokeActiveTokensForDevice(user.id, deviceId);
  const session = await issueRefreshToken(
    user.id,
    req.headers["user-agent"],
    req.ip,
    deviceId
  );

  res.status(200).json({
    user: { userId: user.id, email: user.email },
    access: accessToken,
    session: {
      refreshToken: session.raw,
      expiresAt: session.expiresAt,
      deviceId: session.deviceId,
    },
  });
};

export const refresh = async (req: Request, res: Response) => {
  const { refreshToken, deviceId } = (req as any).body;
  if (!refreshToken) throw HttpError.badRequest("No refresh token provided.");
  if (!deviceId) throw HttpError.badRequest("No deviceId provided.");
  const { userId, newRaw } = await verifyAndRotate(
    refreshToken,
    deviceId,
    req.headers["user-agent"] as string,
    req.ip
  );
  const access = signAccessToken(userId);
  res.json({ newRaw, access });
};

export const logout = async (req: Request, res: Response) => {
  const { refreshToken } = (req as any).body;
  await revokeByRaw(refreshToken);
  res.status(200).json({ msg: "Logged out." });
};

export const logoutAll = async (req: Request, res: Response) => {
  const userId = (req as any).user.id;
  await revokeAll(userId);
  res.status(200).json({ msg: "Logged out from all devices." });
};

export const twofa = async (req: Request, res: Response) => {
  const to = "erdogar23@itu.edu.tr";
  await MailSender.sendMail({ to, text: "deneme", subject: "deneme" });
  res.status(200).json({ msg: "Mail sent." });
};
