import { Router } from "express";
import { validateBody } from "../common/validate.js";
import { asyncHandler } from "../common/asyncHandler.js";
import { adminRouteAuthGuard, roleAuthGuard } from "../common/authGuard.js";
import { RoleName } from "@prisma/client";
import { sendNotificationSchema } from "./notification.validators.js";
import { sendNotificationHandler } from "./notification.controller.js";

const router = Router();

// SYSTEM_ADMIN ya da root push bildirimi gönderebilir.
const adminGuard = roleAuthGuard([RoleName.SYSTEM_ADMIN], { allowRoot: true });

router.post(
  "/send",
  adminRouteAuthGuard,
  adminGuard,
  validateBody(sendNotificationSchema),
  asyncHandler(sendNotificationHandler)
);

export default router;
