import { Router } from "express";
import { validateBody } from "../common/validate.js";
import {
  rootLoginSchema,
  manageSystemAdminSchema,
} from "./rootAdmin.validators.js";
import {
  login,
  logout,
  manageSystemAdminHandler,
} from "./rootAdmin.controller.js";
import { asyncHandler } from "../common/asyncHandler.js";
import { rootAuthGuard } from "../common/authGuard.js";

const router = Router();

router.post("/login", validateBody(rootLoginSchema), asyncHandler(login));

router.post("/logout", asyncHandler(logout));

router.post(
  "/manage-system-admin",
  rootAuthGuard,
  validateBody(manageSystemAdminSchema),
  asyncHandler(manageSystemAdminHandler)
);

export default router;
