import { rateLimit } from "express-rate-limit";
import { RedisStore, type SendCommandFn } from "rate-limit-redis";
import { type Request, type Response } from "express";
import { redis as redisClient } from "../../config/redis.js";

// `ioredis`'s `call` signature is overloaded and doesn't line up exactly with
// `rate-limit-redis`'s expected `SendCommandFn`, so we cast it once here.
const sendCommand: SendCommandFn = (...args: string[]) =>
  redisClient.call(...(args as [string, ...string[]])) as ReturnType<SendCommandFn>;

function rateLimitedHandler(req: Request, res: Response) {
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
