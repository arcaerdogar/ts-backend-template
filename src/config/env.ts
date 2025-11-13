import dotenv from "dotenv";

dotenv.config();

function req(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env: ${name}`);
  return v;
}

export const env = {
  port: Number(req("PORT")),

  jwt: {
    secret: req("JWT_SECRET"),
    accessExpiresMin: Number(req("JWT_ACCESS_EXPIRES_MIN")),
    twoFactorExpiresMin: Number(req("JWT_TWO_FACTOR_EXPIRES_MIN")),
  },

  refresh: {
    expireDays: Number(req("REFRESH_EXPIRES_DAYS")),
  },

  mailService: {
    host: req("MAIL_HOST"),
    port: req("MAIL_PORT"),
    secure: req("MAIL_SECURE"),
    user: req("MAIL_USER"),
    pass: req("MAIL_PASS"),
    from: req("MAIL_FROM"),
  },

  aws: {
    region: req("AWS_REGION"),
    accessKeyId: req("AWS_ACCESS_KEY_ID"),
    secretAccessKey: req("AWS_SECRET_ACCESS_KEY"),
    ses: {
      senderEmail: req("SES_SENDER_EMAIL"),
    },
  },
};
