import type { OAuthProvider } from "@prisma/client";

/**
 * Bir OAuth/OIDC sağlayıcısından normalize edilmiş kimlik. Sağlayıcıya özgü
 * alan isimleri (given_name, picture vb.) buraya taşınmadan önce çözülür;
 * servis katmanı yalnızca bu tek şekli tanır.
 */
export type OAuthIdentity = {
  provider: OAuthProvider;
  /** Sağlayıcıdaki kalıcı kullanıcı kimliği (id_token.sub). Eşleştirme anahtarı. */
  providerAccountId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
};

/**
 * Sağlayıcı-agnostik OAuth arayüzü. Google bu implementasyondaki tek sağlayıcı;
 * GitHub/Apple ileride aynı arayüzün arkasına eklenebilir.
 *
 * NOT: authorize URL'ini backend KURMAZ. App-driven akışta (RFC 8252) app,
 * state + code_verifier + nonce üretip authorize URL'ini kendisi kurar ve sistem
 * tarayıcısında açar. Backend yalnızca app'in getirdiği code'u exchange eder.
 */
export interface OAuthProviderAdapter {
  readonly provider: OAuthProvider;

  /**
   * App'in getirdiği authorization code'u token'a çevirir, id_token'ı DOĞRULAR
   * (decode değil) ve normalize edilmiş kimliği döner. codeVerifier app tarafından
   * üretilip iletilir (PKCE); nonce, app'in authorize'da kullandığı değerdir.
   */
  exchangeCode(code: string, codeVerifier: string, nonce: string): Promise<OAuthIdentity>;
}
