import type { Request, Response } from "express";
import { createHash, randomBytes } from "crypto";
import { env } from "../../../config/env.js";
import { HttpError } from "../../common/errors.js";
import { signAccessToken } from "../jwt.js";
import { issueRefreshToken } from "../refresh.js";
import { recordAuthEvent } from "../authEvent.js";
import { googleProvider } from "./providers/google.provider.js";
import { findOrCreateUserByOAuth } from "./oauth.service.js";
import {
  consumeExchange,
  consumeFlow,
  saveExchange,
  saveFlow,
  type OAuthExchangeData,
} from "./oauth.flow.js";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** PKCE S256: code_challenge = base64url(sha256(code_verifier)). */
function pkceChallenge(verifier: string): string {
  return b64url(createHash("sha256").update(verifier).digest());
}

/**
 * OAUTH_SUCCESS_REDIRECT'i env.allowedOrigins'e karşı doğrular (open-redirect
 * savunması). Origin listede yoksa ya da env boşsa reddeder.
 */
function resolveSuccessRedirect(): URL {
  const target = env.oauth.successRedirect;
  if (!target) {
    throw HttpError.internal("OAUTH_SUCCESS_REDIRECT is not configured.");
  }
  let url: URL;
  try {
    url = new URL(target);
  } catch {
    throw HttpError.internal("OAUTH_SUCCESS_REDIRECT is not a valid URL.");
  }
  const origin = `${url.protocol}//${url.host}`;
  if (!env.allowedOrigins.includes(origin)) {
    throw HttpError.internal(
      "OAUTH_SUCCESS_REDIRECT origin is not in ALLOWED_ORIGINS."
    );
  }
  return url;
}

/**
 * POST /auth/oauth/google/start
 * state + code_verifier + nonce üretir, Redis'e yazar, authorize URL döner.
 */
export const googleStart = async (_req: Request, res: Response) => {
  const state = b64url(randomBytes(32));
  const codeVerifier = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));

  const saved = await saveFlow(state, { codeVerifier, nonce });
  if (!saved) {
    // state çakışması (pratikte imkânsız) -> güvenli tarafta kal.
    throw HttpError.internal("Failed to start OAuth flow.");
  }

  const authorizeUrl = googleProvider.getAuthorizeUrl({
    state,
    codeChallenge: pkceChallenge(codeVerifier),
    nonce,
  });

  res.status(200).json({ authorizeUrl });
};

/**
 * GET /auth/oauth/google/callback?code&state
 * state'i oku-ve-sil, token exchange + id_token verify, kullanıcıyı çöz,
 * oturum aç, tek-kullanımlık exchange kodu üret, frontend'e 302 yönlendir.
 */
export const googleCallback = async (req: Request, res: Response) => {
  const { code, state } = (req as any).validatedQuery as {
    code: string;
    state: string;
  };
  const ip = req.ip;
  const userAgent = req.headers["user-agent"];

  // Yönlendirme hedefini token exchange'den ÖNCE doğrula (yanlış yapılandırmada
  // Google'a gereksiz istek atma).
  const redirectUrl = resolveSuccessRedirect();

  // state: oku-ve-HEMEN-SİL (atomik). Yoksa/expired -> mismatch.
  const flow = await consumeFlow(state);
  if (!flow) {
    await recordAuthEvent({
      type: "OAUTH_STATE_MISMATCH",
      ip,
      userAgent,
      meta: { provider: "GOOGLE", reason: "state_missing_or_expired" },
    });
    throw HttpError.badRequest(
      "OAuth state mismatch or expired.",
      "OAUTH_STATE_MISMATCH"
    );
  }

  const identity = await googleProvider.exchangeCode(
    code,
    flow.codeVerifier,
    flow.nonce
  );

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
  const exchangeData: OAuthExchangeData = {
    user: { userId: user.id, email: user.email },
    access,
    session: {
      refreshToken: session.raw,
      expiresAt: session.expiresAt.toISOString(),
      deviceId: session.deviceId,
    },
  };

  const exchangeCode = b64url(randomBytes(32));
  const stored = await saveExchange(exchangeCode, exchangeData);
  if (!stored) throw HttpError.internal("Failed to persist OAuth session.");

  // Token'lar fragment'e/URL'e KONMAZ; sadece tek-kullanımlık kod taşınır.
  redirectUrl.searchParams.set("exchange", exchangeCode);
  res.redirect(302, redirectUrl.toString());
};

/**
 * POST /auth/oauth/exchange { exchangeCode }
 * Tek-kullanımlık kodu oku-ve-sil, login-şekilli oturumu döndür.
 */
export const oauthExchange = async (req: Request, res: Response) => {
  const { exchangeCode } = (req as any).body as { exchangeCode: string };
  const data = await consumeExchange(exchangeCode);
  if (!data) {
    throw HttpError.badRequest(
      "Invalid or expired exchange code.",
      "OAUTH_EXCHANGE_INVALID"
    );
  }
  res.status(200).json(data);
};
