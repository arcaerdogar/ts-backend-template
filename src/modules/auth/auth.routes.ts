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
  login,
  logout,
  logoutAll,
  refresh,
  register,
  twofa,
} from "./auth.controller.js";
import { authGuard } from "../common/authGuard.js";

const router = Router();

router.post("/register", validateBody(registerSchema), asyncHandler(register));

router.post("/login", validateBody(loginSchema), asyncHandler(login));

router.post("/logout", validateBody(logoutSchema), asyncHandler(logout));

router.post("/logout-all", authGuard, asyncHandler(logoutAll));

router.post("/refresh", validateBody(refreshSchema), asyncHandler(refresh));

router.post("/2fa", authGuard, validateBody(twofaSchema), asyncHandler(twofa));

// router.post("/verify-email");

// router.post("/reset-password");

export default router;
