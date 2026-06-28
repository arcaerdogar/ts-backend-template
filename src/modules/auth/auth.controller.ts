import type { NextFunction, Request, Response } from "express";
import {
  createUser,
  getUserInfo,
  resetUserPassword,
  updateUserEmail,
  verifyUser,
  verifyUserEmail,
} from "./users.service.js";
import { sign2faToken, signAccessToken, verify2faToken } from "./jwt.js";
import {
  issueRefreshToken,
  verifyAndRotate,
  revokeActiveTokensForDevice,
  revokeByRaw,
  revokeAll,
} from "./refresh.js";
import { HttpError } from "../common/errors.js";
import { MailSender } from "../../services/mail-service/mailSender.js";
import { recordAuthEvent } from "./authEvent.js";

// deviceId ve refreshToken'ı direkt response body'sinde göndererek çözeceğiz. Mobilde cookie yok.

export const register = async (req: Request, res: Response) => {
  const { email: emailRaw, password: passwordRaw, firstName, lastName } = (
    req as any
  ).body;
  const { id, email } = await createUser(
    emailRaw,
    passwordRaw,
    firstName,
    lastName
  );
  const accessToken = signAccessToken(id);
  const { raw, deviceId } = await issueRefreshToken(
    id,
    req.headers["user-agent"],
    req.ip
  );
  await recordAuthEvent({
    type: "LOGIN",
    userId: id,
    email,
    deviceId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  res.status(201).json({
    user: { id, email },
    profile: { firstName, lastName },
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
  const user = await verifyUser(email, password, {
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });
  const accessToken = signAccessToken(user.id);
  if (deviceId) await revokeActiveTokensForDevice(user.id, deviceId);
  const session = await issueRefreshToken(
    user.id,
    req.headers["user-agent"],
    req.ip,
    deviceId
  );
  await recordAuthEvent({
    type: "LOGIN",
    userId: user.id,
    email: user.email,
    deviceId: session.deviceId,
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  });

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
  const userId = await revokeByRaw(refreshToken);
  if (userId)
    await recordAuthEvent({ type: "LOGOUT", userId, ip: req.ip });
  res.status(200).json({ msg: "Logged out." });
};

export const logoutAll = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  await revokeAll(userId);
  await recordAuthEvent({ type: "LOGOUT_ALL", userId, ip: req.ip });
  res.status(200).json({ msg: "Logged out from all devices." });
};

export const twofa = async (req: Request, res: Response) => {
  // html automatically transforms token to lowercase in link format. Should send token base64 encoded to avoid this problem.
  const userId = req.user!.id;
  const user = await getUserInfo(userId);
  const { scope, newEmail } = req.body;
  const twofaToken =
    scope === "change-email"
      ? sign2faToken(userId, scope, { newEmail })
      : sign2faToken(userId, scope);
  const mailer = new MailSender();
  if (scope == "change-email")
    await mailer.sendEmailChangeEmail(user.email, twofaToken, "Kullanıcı");
  else if (scope == "reset-password")
    await mailer.sendPasswordResetEmail(user.email, twofaToken, "Kullanıcı");
  else if (scope == "verify-email")
    await mailer.sendVerificationEmail(user.email, twofaToken, "Kullanıcı");
  else throw HttpError.internal();
  await recordAuthEvent({
    type: "TWO_FA_ISSUED",
    userId,
    email: user.email,
    ip: req.ip,
    meta: { scope },
  });
  res.status(200).json({ msg: `Verification email sent to ${user.email}` });
};

export const verifyEmail = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const verifiedUser = await verifyUserEmail(userId);
  res
    .status(200)
    .json({ msg: `Mail address ${verifiedUser.email} verified for user.` });
};

export const resetPassword = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { newPassword } = req.body;
  const updatedUser = await resetUserPassword(userId, newPassword);
  res
    .status(200)
    .json({ msg: `Password reset for user with email: ${updatedUser.email}` });
};

export const changeEmail = async (req: Request, res: Response) => {
  const token = req.query.token as string;
  const payload = verify2faToken(token);
  if (!payload.newEmail) {
    throw HttpError.badRequest("Invalid token: missing newEmail.");
  }
  const updatedUser = await updateUserEmail(req.user!.id, payload.newEmail);
  res.status(200).json({ msg: `Email changed to ${updatedUser.email}` });
};
