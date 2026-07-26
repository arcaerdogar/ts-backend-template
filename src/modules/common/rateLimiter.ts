import { rateLimit } from "express-rate-limit";
import { RedisStore, type SendCommandFn } from "rate-limit-redis";
import { type Request, type Response } from "express";
import { redis as redisClient } from "../../config/redis.js";
import { logger } from "../../config/logger.js";

// `ioredis`'s `call` signature is overloaded and doesn't line up exactly with
// `rate-limit-redis`'s expected `SendCommandFn`, so we cast it once here.
const sendCommand: SendCommandFn = (...args: string[]) =>
  redisClient.call(...(args as [string, ...string[]])) as ReturnType<SendCommandFn>;

function rateLimitedHandler(req: Request, res: Response) {
  logger.warn(
    { ip: req.ip, path: req.path, method: req.method },
    "Rate limit exceeded"
  );
  res.status(429).json({
    error: "RATE_LIMITED",
    message: "Too many requests, please try again later.",
  });
}

/**
 * Prevents login brute-force attacks.
 */
export const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests, please try again later." },
  handler: rateLimitedHandler,
  store: new RedisStore({
    prefix: "rl:login:",
    sendCommand,
  }),
});

/**
 * Prevents mass fake-account creation.
 */
export const registerLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests, please try again later." },
  handler: rateLimitedHandler,
  store: new RedisStore({
    prefix: "rl:register:",
    sendCommand,
  }),
});

/**
 * Prevents flooding the email queue via /auth/2fa.
 */
export const twoFaLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests, please try again later." },
  handler: rateLimitedHandler,
  store: new RedisStore({
    prefix: "rl:2fa:",
    sendCommand,
  }),
});

/**
 * Protects the OAuth flow (start / callback / exchange) from abuse and replay
 * spam. Applied to every /auth/oauth route.
 */
export const oauthLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "RATE_LIMITED", message: "Too many requests, please try again later." },
  handler: rateLimitedHandler,
  store: new RedisStore({
    prefix: "rl:oauth:",
    sendCommand,
  }),
});
