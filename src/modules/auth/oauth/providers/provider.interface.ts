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

/** authorize URL üretmek için gereken tek-kullanımlık akış parametreleri. */
export type AuthorizeParams = {
  state: string;
  codeChallenge: string;
  nonce: string;
};

/**
 * Sağlayıcı-agnostik OAuth arayüzü. Google bu PR'da tek implementasyon; GitHub/
 * Apple ileride aynı arayüzün arkasına eklenebilir (bu PR'da DEĞİL).
 */
export interface OAuthProviderAdapter {
  readonly provider: OAuthProvider;

  /** PKCE + state + nonce ile sağlayıcının authorize URL'ini kurar. */
  getAuthorizeUrl(params: AuthorizeParams): string;

  /**
   * authorization code'u token'a çevirir, id_token'ı DOĞRULAR (decode değil)
   * ve normalize edilmiş kimliği döner. nonce, akış başında üretilen değerle
   * eşleşmelidir.
   */
  exchangeCode(code: string, codeVerifier: string, nonce: string): Promise<OAuthIdentity>;
}
