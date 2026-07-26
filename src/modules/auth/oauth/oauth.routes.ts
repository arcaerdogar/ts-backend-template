import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import { validateBody, validateQuery } from "../../common/validate.js";
import { oauthLimiter } from "../../common/rateLimiter.js";
import {
  googleCallback,
  googleStart,
  oauthExchange,
} from "./oauth.controller.js";
import {
  oauthCallbackQuerySchema,
  oauthExchangeSchema,
  oauthStartSchema,
} from "./oauth.validators.js";

// Bu router yalnızca Google OAuth aktifken mount edilir (bkz. auth.routes.ts).
const router = Router();

router.post(
  "/google/start",
  oauthLimiter,
  validateBody(oauthStartSchema),
  asyncHandler(googleStart)
);

router.get(
  "/google/callback",
  oauthLimiter,
  validateQuery(oauthCallbackQuerySchema),
  asyncHandler(googleCallback)
);

router.post(
  "/exchange",
  oauthLimiter,
  validateBody(oauthExchangeSchema),
  asyncHandler(oauthExchange)
);

export default router;
