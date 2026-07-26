import { redis } from "../../../config/redis.js";

/**
 * OAuth akış durumu (state). Backend-driven redirect + PKCE için start'ta
 * üretilip callback'te bir kez tüketilir. twoFactorDenylist.ts'teki SET NX EX
 * tek-kullanımlık mantığının kardeşi; burada payload da taşınır.
 */
const FLOW_TTL_SECONDS = 600; // 10 dk: authorize -> callback penceresi
const EXCHANGE_TTL_SECONDS = 60; // 60 sn: callback -> frontend exchange penceresi

const flowKey = (state: string) => `oauth:flow:${state}`;
const exchangeKey = (code: string) => `oauth:exchange:${code}`;

export type OAuthFlowData = {
  codeVerifier: string;
  nonce: string;
};

/**
 * Login endpoint'iyle BİREBİR aynı şekle sahip oturum verisi. exchange_code ile
 * tek kullanımlık teslim edilir; token'lar fragment'e/URL'e konmaz.
 */
export type OAuthExchangeData = {
  user: { userId: string; email: string };
  access: string;
  session: {
    refreshToken: string;
    expiresAt: string;
    deviceId: string;
  };
};

/**
 * Akış durumunu SET NX EX ile atomik yazar. NX sayesinde aynı state ikinci kez
 * yazılamaz (çakışma = false).
 */
export async function saveFlow(
  state: string,
  data: OAuthFlowData
): Promise<boolean> {
  const res = await redis.set(
    flowKey(state),
    JSON.stringify(data),
    "EX",
    FLOW_TTL_SECONDS,
    "NX"
  );
  return res === "OK";
}

/**
 * Akış durumunu oku-ve-HEMEN-SİL (atomik GETDEL). İkinci okuma null döner ->
 * state replay engellenir.
 */
export async function consumeFlow(
  state: string
): Promise<OAuthFlowData | null> {
  const raw = await redis.getdel(flowKey(state));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthFlowData;
  } catch {
    return null;
  }
}

/** Tek-kullanımlık exchange kodunun oturum verisini kısa TTL ile saklar. */
export async function saveExchange(
  code: string,
  data: OAuthExchangeData
): Promise<boolean> {
  const res = await redis.set(
    exchangeKey(code),
    JSON.stringify(data),
    "EX",
    EXCHANGE_TTL_SECONDS,
    "NX"
  );
  return res === "OK";
}

/**
 * Exchange kodunu oku-ve-HEMEN-SİL (atomik GETDEL). İkinci okuma null ->
 * exchange kodu tek kullanımlık, replay engellenir.
 */
export async function consumeExchange(
  code: string
): Promise<OAuthExchangeData | null> {
  const raw = await redis.getdel(exchangeKey(code));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as OAuthExchangeData;
  } catch {
    return null;
  }
}
