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

  // OAuth OPSIYONEL: bu bir template; OAuth kullanmayan projeler bu env'ler
  // olmadan da boot edebilmeli. Bu yüzden req() DEĞİL, process.env ile okunur.
  oauth: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
      redirectUri: process.env.GOOGLE_REDIRECT_URI,
    },
    // Callback sonrası frontend'e yönlendirme hedefi (exchange kodu bununla teslim edilir).
    successRedirect: process.env.OAUTH_SUCCESS_REDIRECT,
  },
};

/**
 * Google OAuth "aktif" sayılır ancak client id + secret + redirect uri'nin
 * ÜÇÜ de doluysa. Aktif değilse oauth rotaları hiç mount edilmez (bkz.
 * server.ts) -> yarım yapılandırmayla sessiz hataya düşülmez.
 */
export const isGoogleOAuthEnabled = (): boolean =>
  Boolean(
    env.oauth.google.clientId &&
      env.oauth.google.clientSecret &&
      env.oauth.google.redirectUri
  );
