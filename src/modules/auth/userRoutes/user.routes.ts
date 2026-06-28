import { Router } from "express";
import {
  validateParams,
  validateQuery,
  validateBody,
} from "../../common/validate.js";
import {
  userIdParamSchema,
  listUsersQuerySchema,
  suspendUserBodySchema,
} from "./user.validators.js";
import {
  listUsersHandler,
  getUserByIdHandler,
  suspendUserHandler,
} from "./user.controllers.js";
import { asyncHandler } from "../../common/asyncHandler.js";
import { adminRouteAuthGuard, roleAuthGuard } from "../../common/authGuard.js";
import { RoleName } from "@prisma/client";

const router = Router();

// SYSTEM_ADMIN ya da root erişebilir.
const adminGuard = roleAuthGuard([RoleName.SYSTEM_ADMIN], { allowRoot: true });

router.get(
  "/",
  adminRouteAuthGuard,
  adminGuard,
  validateQuery(listUsersQuerySchema),
  asyncHandler(listUsersHandler)
);

router.get(
  "/:id",
  adminRouteAuthGuard,
  adminGuard,
  validateParams(userIdParamSchema),
  asyncHandler(getUserByIdHandler)
);

router.patch(
  "/:id/suspend",
  adminRouteAuthGuard,
  adminGuard,
  validateParams(userIdParamSchema),
  validateBody(suspendUserBodySchema),
  asyncHandler(suspendUserHandler)
);

export default router;
