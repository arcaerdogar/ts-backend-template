import { createPublicKey, type KeyObject } from "crypto";
import { HttpError } from "../../common/errors.js";

/** Google'ın OIDC imza anahtarlarının (JWKS) yayınlandığı sabit endpoint. */
const GOOGLE_CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";

type Jwk = {
  kid: string;
  kty: string;
  alg?: string;
  use?: string;
  n: string;
  e: string;
};

type JwkSet = { keys: Jwk[] };

// kid -> public key önbelleği. Google anahtarları döndürür; Cache-Control
// max-age'ine göre TTL uygulanır, süre dolunca tembel yenilenir.
let cache: { keys: Map<string, KeyObject>; expiresAt: number } | null = null;

/** Cache-Control başlığından max-age (saniye) okur; yoksa 1 saat varsayar. */
function parseMaxAge(cacheControl: string | null): number {
  if (!cacheControl) return 3600;
  const m = /max-age=(\d+)/i.exec(cacheControl);
  return m && m[1] ? Number(m[1]) : 3600;
}

async function refresh(): Promise<Map<string, KeyObject>> {
  const res = await fetch(GOOGLE_CERTS_URL);
  if (!res.ok) {
    throw HttpError.internal("Failed to fetch Google signing keys.");
  }
  const body = (await res.json()) as JwkSet;
  const keys = new Map<string, KeyObject>();
  for (const jwk of body.keys ?? []) {
    // Node, JWK'dan doğrudan public KeyObject üretebilir (harici kütüphane yok).
    keys.set(jwk.kid, createPublicKey({ key: jwk, format: "jwk" }));
  }
  const maxAge = parseMaxAge(res.headers.get("cache-control"));
  cache = { keys, expiresAt: Date.now() + maxAge * 1000 };
  return keys;
}

/**
 * Verilen `kid` için Google imza anahtarını (public key) döner. Önbellek boş,
 * süresi dolmuş ya da kid bulunamamışsa bir kez zorla yeniler (anahtar rotasyonu).
 */
export async function getGoogleSigningKey(kid: string): Promise<KeyObject> {
  let keys =
    !cache || cache.expiresAt <= Date.now() ? await refresh() : cache.keys;

  let key = keys.get(kid);
  if (!key) {
    // kid önbellekte yok: anahtarlar rotate edilmiş olabilir, bir kez zorla yenile.
    keys = await refresh();
    key = keys.get(kid);
  }
  if (!key) {
    throw HttpError.unauthorized(
      "Unknown token signing key.",
      "OAUTH_INVALID_TOKEN"
    );
  }
  return key;
}

/** Test amaçlı: JWKS önbelleğini sıfırlar (testler arası izolasyon). */
export function _clearJwksCache(): void {
  cache = null;
}
