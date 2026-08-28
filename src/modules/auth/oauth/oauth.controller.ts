import type { Request, Response } from "express";
import { signAccessToken } from "../jwt.js";
import { issueRefreshToken } from "../refresh.js";
import { recordAuthEvent } from "../authEvent.js";
import { googleProvider } from "./providers/google.provider.js";
import { findOrCreateUserByOAuth } from "./oauth.service.js";

/**
 * POST /auth/oauth/google  (app-driven, RFC 8252 — bkz. ADR 0002)
 *
 * App, sistem tarayıcısındaki authorize'dan dönen code'u + PKCE code_verifier'ı
 * + nonce'u getirir (state'i app kendisi lokal doğruladı, backend'e gelmez).
 * Backend:
 *   1) (opsiyonel) app attestation — route'ta middleware ile
 *   2) code -> token exchange + id_token DOĞRULAMA (imza/iss/aud/exp/nonce)
 *   3) sub ile kullanıcıyı bul/oluştur/bağla
 *   4) KENDİ oturumunu üretir (signAccessToken + issueRefreshToken)
 * ve login endpoint'iyle BİREBİR aynı şekilde yanıt döner. Google'ın
 * access/refresh token'ları cihaza inmez, DB'ye yazılmaz.
 */
export const googleOAuth = async (req: Request, res: Response) => {
  const { code, codeVerifier, nonce } = (req as any).body as {
    code: string;
    codeVerifier: string;
    nonce: string;
  };
  const ip = req.ip;
  const userAgent = req.headers["user-agent"];

  const identity = await googleProvider.exchangeCode(code, codeVerifier, nonce);
  const { user, outcome } = await findOrCreateUserByOAuth(identity);

  const access = signAccessToken(user.id);
  const session = await issueRefreshToken(user.id, userAgent, ip);

  const auditType =
    outcome === "REGISTERED"
      ? "OAUTH_REGISTER"
      : outcome === "LINKED"
        ? "OAUTH_LINKED"
        : "OAUTH_LOGIN";
  await recordAuthEvent({
    type: auditType,
    userId: user.id,
    email: user.email,
    deviceId: session.deviceId,
    ip,
    userAgent,
    meta: { provider: "GOOGLE" },
  });

  // Login endpoint'iyle BİREBİR aynı oturum şekli.
  res.status(200).json({
    user: { userId: user.id, email: user.email },
    access,
    session: {
      refreshToken: session.raw,
      expiresAt: session.expiresAt,
      deviceId: session.deviceId,
    },
  });
};
