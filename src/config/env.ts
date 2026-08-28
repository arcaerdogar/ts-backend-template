import dotenv from "dotenv";

dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  port: Number(req("PORT")),

  allowedOrigins: req("ALLOWED_ORIGINS")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),

  jwt: {
    secret: req("JWT_SECRET"),
    accessExpiresMin: Number(req("JWT_ACCESS_EXPIRES_MIN")),
    twoFactorExpiresMin: Number(req("JWT_TWO_FACTOR_EXPIRES_MIN")),
    twoFactorSecret: req("JWT_TWO_FACTOR_SECRET"),
    /** Root admin JWT (cookie + Bearer) süresi (dakika). Varsayılan 60. */
    rootExpiresMin: Number(process.env.JWT_ROOT_EXPIRES_MIN ?? "60"),
  },

  cookies: {
    rootAccessName: process.env.ROOT_ACCESS_COOKIE_NAME ?? "root_access",
    secure:
      process.env.COOKIE_SECURE === "true" ||
      process.env.NODE_ENV === "production",
  },

  refresh: {
    expireDays: Number(req("REFRESH_EXPIRES_DAYS")),
    tokenHashSecret: req("REFRESH_TOKEN_HASH_SECRET"),
  },

  aws: {
    region: req("AWS_REGION"),
    accessKeyId: req("AWS_ACCESS_KEY_ID"),
    secretAccessKey: req("AWS_SECRET_ACCESS_KEY"),
    ses: {
      senderEmail: req("SES_SENDER_EMAIL"),
    },
    s3: {
      bucket: req("S3_BUCKET_NAME"),
      cdnDomain: process.env.CDN_DOMAIN, // Optional
    },
  },

  redis: {
    url: req("REDIS_URL"),
  },

  admin: {
    email: req("ADMIN_EMAIL"),
    password: req("ADMIN_PASSWORD"),
  },

  // Firebase Cloud Messaging OPSIYONEL: bu bir template; push bildirimi
  // kullanmayan projeler bu env'ler olmadan da boot edebilmeli. Bu yüzden
  // req() DEĞİL, process.env ile okunur. Yapılandırılmamışsa tüm gönderimler
  // sessizce no-op olur (bkz. notifications/firebase.config.ts).
  //
  // İki yol desteklenir: (1) FIREBASE_SERVICE_ACCOUNT_PATH ile service account
  // JSON dosyası, ya da (2) FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL +
  // FIREBASE_PRIVATE_KEY üçlüsü (private key'de \n kaçışları düzeltilir).
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
    privateKey: process.env.FIREBASE_PRIVATE_KEY
      ? process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, "\n")
      : undefined,
    serviceAccountPath: process.env.FIREBASE_SERVICE_ACCOUNT_PATH,
  },

  // OAuth OPSIYONEL: bu bir template; OAuth kullanmayan projeler bu env'ler
  // olmadan da boot edebilmeli. Bu yüzden req() DEĞİL, process.env ile okunur.
  //
  // Akış app-driven (RFC 8252): app authorize'ı sistem tarayıcısında sürer,
  // code'u backend'e verir, exchange'i backend yapar. client_secret bir public
  // native client'ta YOKTUR (Google iOS/Android client tipi secret vermez) ->
  // OPSIYONEL. redirectUri, app'in App Link / Universal Link adresidir ve token
  // exchange'de echo'lanır.
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET, // public client'ta yok; opsiyonel
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },
    // App attestation (Play Integrity / App Attest) doğrulaması. Varsayılan
    // kapalı; açıkken /auth/oauth/google isteği geçerli bir attestation ister
    // (bkz. oauth/attestation.ts). Gerçek doğrulayıcı platform kimlik
    // bilgileriyle projede bağlanır.
    attestation: {
      enabled: process.env.OAUTH_ATTESTATION_ENABLED === "true",
    },
  },
};

/**
 * Google OAuth "aktif" sayılır ancak client id + redirect uri doluysa.
 * client_secret public client'ta bulunmadığı için ŞART DEĞİLDİR. Aktif değilse
 * oauth rotaları hiç mount edilmez (bkz. auth.routes.ts) -> yarım
 * yapılandırmayla sessiz hataya düşülmez.
 */
export const isGoogleOAuthEnabled = (): boolean =>
  Boolean(env.oauth.google.clientId && env.oauth.google.redirectUri);
