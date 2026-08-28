import { Router } from "express";
import { asyncHandler } from "../../common/asyncHandler.js";
import { validateBody } from "../../common/validate.js";
import { oauthLimiter } from "../../common/rateLimiter.js";
import { googleOAuth } from "./oauth.controller.js";
import { oauthGoogleSchema } from "./oauth.validators.js";
import { appAttestationGuard } from "./attestation.js";

// Bu router yalnızca Google OAuth aktifken mount edilir (bkz. auth.routes.ts).
// App-driven akış (RFC 8252): tek endpoint. /start + /callback + /exchange yok;
// authorize'ı app sürer, backend sadece code'u exchange eder (bkz. ADR 0002).
const router = Router();

router.post(
  "/google",
  oauthLimiter,
  asyncHandler(appAttestationGuard),
  validateBody(oauthGoogleSchema),
  asyncHandler(googleOAuth)
);

export default router;
