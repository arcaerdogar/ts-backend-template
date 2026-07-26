import { prisma } from "../../../config/db.js";
import { HttpError } from "../../common/errors.js";
import type { OAuthIdentity } from "./providers/provider.interface.js";

/**
 * Callback sonucunun türü. Controller buna göre tek bir audit olayı yazar
 * (OAUTH_REGISTER / OAUTH_LOGIN / OAUTH_LINKED).
 */
export type OAuthLoginOutcome = "REGISTERED" | "LOGGED_IN" | "LINKED";

export type OAuthResolveResult = {
  user: { id: string; email: string };
  outcome: OAuthLoginOutcome;
};

/**
 * createUser'ın kardeşi: OAuth kimliğini bir kullanıcıya bağlar veya yeni
 * kullanıcı oluşturur. Eşleştirme birincil anahtarı DAİMA providerAccountId
 * (= id_token.sub), email DEĞİL.
 *
 * Karar tablosu:
 *  - OAuthAccount(provider, sub) zaten varsa   -> LOGGED_IN (mevcut user)
 *  - yoksa ve email sahibi bir user varsa:
 *      * çift taraflı emailVerified===true      -> LINKED (OAuthAccount eklenir)
 *      * aksi halde                             -> 409 (sessiz devralma YOK)
 *  - email sahibi user yoksa                    -> REGISTERED (User+Profile+OAuthAccount tek transaction)
 */
export async function findOrCreateUserByOAuth(
  identity: OAuthIdentity
): Promise<OAuthResolveResult> {
  const email = identity.email.trim().toLowerCase();

  // 1) Bu OAuth kimliği daha önce bağlanmış mı? (sub üzerinden)
  const existingAccount = await prisma.oAuthAccount.findUnique({
    where: {
      provider_providerAccountId: {
        provider: identity.provider,
        providerAccountId: identity.providerAccountId,
      },
    },
    select: { user: { select: { id: true, email: true } } },
  });
  if (existingAccount) {
    return { user: existingAccount.user, outcome: "LOGGED_IN" };
  }

  // 2) Aynı e-postaya sahip mevcut bir kullanıcı var mı?
  const userByEmail = await prisma.user.findUnique({
    where: { email },
    select: { id: true, email: true, emailVerified: true },
  });

  if (userByEmail) {
    // Otomatik link YALNIZCA çift taraflı doğrulanmış e-posta ile.
    if (identity.emailVerified && userByEmail.emailVerified) {
      await prisma.oAuthAccount.create({
        data: {
          userId: userByEmail.id,
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
          email,
        },
      });
      return {
        user: { id: userByEmail.id, email: userByEmail.email },
        outcome: "LINKED",
      };
    }

    // Doğrulama koşulu sağlanmıyor: e-posta başkası tarafından kullanılıyor ve
    // güvenli otomatik link mümkün değil. Sessizce devralma YAPMA.
    throw HttpError.conflict(
      "An account with this email already exists. Sign in to link your Google account.",
      "OAUTH_EMAIL_EXISTS"
    );
  }

  // 3) Yeni kullanıcı: User + Profile + OAuthAccount TEK transaction (nested
  //    create). Profil zorunluluğu korunur; passwordHash null kalır.
  const user = await prisma.user.create({
    data: {
      email,
      emailVerified: identity.emailVerified,
      profile: {
        create: { firstName: identity.firstName, lastName: identity.lastName },
      },
      oauthAccounts: {
        create: {
          provider: identity.provider,
          providerAccountId: identity.providerAccountId,
          email,
        },
      },
    },
    select: { id: true, email: true },
  });

  return { user, outcome: "REGISTERED" };
}
