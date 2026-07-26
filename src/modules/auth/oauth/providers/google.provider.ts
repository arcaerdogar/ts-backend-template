import jwt from "jsonwebtoken";
import { env } from "../../../../config/env.js";
import { HttpError } from "../../../common/errors.js";
import { getGoogleSigningKey } from "../jwks.js";
import type { AuthorizeParams, OAuthIdentity, OAuthProviderAdapter } from "./provider.interface.js";

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
// Google id_token'ında kabul edilen iss değerleri (iki varyant da geçerlidir).
const GOOGLE_ISSUERS: [string, string] = [
  "https://accounts.google.com",
  "accounts.google.com",
];

type GoogleIdTokenClaims = {
  sub?: string;
  email?: string;
  email_verified?: boolean | string;
  name?: string;
  given_name?: string;
  family_name?: string;
  picture?: string;
  nonce?: string;
};

/** Yalnızca tam yapılandırılmışken (env aktifken) çağrılır; aksi halde patlar. */
function googleConfig() {
  const { clientId, clientSecret, redirectUri } = env.oauth.google;
  if (!clientId || !clientSecret || !redirectUri) {
    throw HttpError.internal("Google OAuth is not configured.");
  }
  return { clientId, clientSecret, redirectUri };
}

/**
 * Profile.firstName/lastName NOT NULL ve boş olamaz. Google claim'lerinden ad
 * çözümleme sırası: given/family -> name'i boşluktan böl -> email'in local kısmı.
 */
function resolveNames(
  claims: GoogleIdTokenClaims,
  email: string
): { firstName: string; lastName: string } {
  const given = typeof claims.given_name === "string" ? claims.given_name.trim() : "";
  const family = typeof claims.family_name === "string" ? claims.family_name.trim() : "";
  if (given || family) {
    return { firstName: given || family, lastName: family || given };
  }

  const name = typeof claims.name === "string" ? claims.name.trim() : "";
  if (name) {
    const parts = name.split(/\s+/);
    const first = parts[0] ?? name;
    const last = parts.length > 1 ? parts.slice(1).join(" ") : first;
    return { firstName: first, lastName: last };
  }

  const local = email.split("@")[0] || "user";
  return { firstName: local, lastName: local };
}

/**
 * id_token'ı DOĞRULAR (decode DEĞİL): imza (JWKS) + iss + aud + exp jwt.verify
 * ile, nonce ise akış başındaki değerle elle karşılaştırılır. Başarılıysa
 * normalize edilmiş OAuthIdentity döner.
 */
export async function verifyGoogleIdToken(
  idToken: string,
  expectedNonce: string
): Promise<OAuthIdentity> {
  const { clientId } = googleConfig();

  // Sadece header'ı decode et (kid seçmek için) -> imza HÂLÂ doğrulanacak.
  const decoded = jwt.decode(idToken, { complete: true });
  if (!decoded || typeof decoded === "string" || !decoded.header.kid) {
    throw HttpError.unauthorized("Malformed id_token.", "OAUTH_INVALID_TOKEN");
  }

  const key = await getGoogleSigningKey(decoded.header.kid);

  let claims: GoogleIdTokenClaims;
  try {
    claims = jwt.verify(idToken, key, {
      algorithms: ["RS256"], // alg-confusion'ı engelle: RS256 dışına izin verme
      audience: clientId,
      issuer: GOOGLE_ISSUERS,
    }) as GoogleIdTokenClaims;
  } catch {
    throw HttpError.unauthorized(
      "id_token verification failed.",
      "OAUTH_INVALID_TOKEN"
    );
  }

  // nonce'u jwt.verify kontrol etmez -> replay/injection'a karşı elle doğrula.
  if (!claims.nonce || claims.nonce !== expectedNonce) {
    throw HttpError.unauthorized("id_token nonce mismatch.", "OAUTH_INVALID_TOKEN");
  }

  if (!claims.sub) {
    throw HttpError.unauthorized("id_token missing sub.", "OAUTH_INVALID_TOKEN");
  }
  const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
  if (!email) {
    throw HttpError.unauthorized("id_token missing email.", "OAUTH_INVALID_TOKEN");
  }

  const emailVerified = claims.email_verified === true || claims.email_verified === "true";
  const { firstName, lastName } = resolveNames(claims, email);
  const picture = typeof claims.picture === "string" ? claims.picture : undefined;

  return {
    provider: "GOOGLE",
    providerAccountId: claims.sub,
    email,
    emailVerified,
    firstName,
    lastName,
    ...(picture ? { avatarUrl: picture } : {}),
  };
}

export const googleProvider: OAuthProviderAdapter = {
  provider: "GOOGLE",

  getAuthorizeUrl({ state, codeChallenge, nonce }: AuthorizeParams): string {
    const { clientId, redirectUri } = googleConfig();
    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: "openid email profile",
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: "S256",
      prompt: "select_account",
    });
    return `${GOOGLE_AUTHORIZE_URL}?${params.toString()}`;
  },

  async exchangeCode(
    code: string,
    codeVerifier: string,
    nonce: string
  ): Promise<OAuthIdentity> {
    const { clientId, clientSecret, redirectUri } = googleConfig();

    const res = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      // redirect_uri, authorize'daki ile AYNI olmalı (sabit env'den gelir).
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        code_verifier: codeVerifier,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }).toString(),
    });

    if (!res.ok) {
      throw HttpError.unauthorized(
        "Google token exchange failed.",
        "OAUTH_TOKEN_EXCHANGE_FAILED"
      );
    }

    // Sadece id_token kullanılır. access_token/refresh_token KASITLI kullanılmaz
    // ve DB'ye YAZILMAZ.
    const tokens = (await res.json()) as { id_token?: string };
    if (!tokens.id_token) {
      throw HttpError.unauthorized(
        "Google token response missing id_token.",
        "OAUTH_TOKEN_EXCHANGE_FAILED"
      );
    }

    return verifyGoogleIdToken(tokens.id_token, nonce);
  },
};
