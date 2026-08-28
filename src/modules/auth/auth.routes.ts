import { Router } from "express";
import { validateBody } from "../common/validate.js";
import {
  loginSchema,
  logoutSchema,
  refreshSchema,
  registerSchema,
  twofaSchema,
} from "./auth.validators.js";
import { asyncHandler } from "../common/asyncHandler.js";
import {
  changeEmail,
  login,
  logout,
  logoutAll,
  refresh,
  register,
  resetPassword,
  twofa,
  verifyEmail,
} from "./auth.controller.js";
import { authGuard, twoFactorAuthGuard } from "../common/authGuard.js";
import { loginLimiter, registerLimiter, twoFaLimiter } from "../common/rateLimiter.js";
import { isGoogleOAuthEnabled } from "../../config/env.js";
import oauthRouter from "./oauth/oauth.routes.js";

const router = Router();

// OAuth OPSIYONEL: yalnızca Google tam yapılandırılmışsa mount edilir. Aktif
// değilse /auth/oauth/* rotaları hiç var olmaz (yarım config ile sessiz hata yok).
if (isGoogleOAuthEnabled()) {
  router.use("/oauth", oauthRouter);
}

router.post(
  "/register",
  registerLimiter,
  validateBody(registerSchema),
  asyncHandler(register)
);

router.post("/login", loginLimiter, validateBody(loginSchema), asyncHandler(login));

router.post("/logout", validateBody(logoutSchema), asyncHandler(logout));

router.post("/logout-all", authGuard, asyncHandler(logoutAll));

router.post("/refresh", validateBody(refreshSchema), asyncHandler(refresh));

router.post(
  "/2fa",
  twoFaLimiter,
  authGuard,
  validateBody(twofaSchema),
  asyncHandler(twofa)
);

router.post(
  "/verify-email",
  authGuard,
  twoFactorAuthGuard("verify-email"),
  asyncHandler(verifyEmail)
);

router.post(
  "/reset-password",
  authGuard,
  twoFactorAuthGuard("reset-password"),
  asyncHandler(resetPassword)
);

router.post(
  "/change-email",
  authGuard,
  twoFactorAuthGuard("change-email"),
  asyncHandler(changeEmail)
);

export default router;
