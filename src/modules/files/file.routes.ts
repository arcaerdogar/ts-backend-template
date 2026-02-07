import { Router } from "express";
import {
  initUpload,
  confirmUpload,
  getDownloadUrl,
  deleteFile,
} from "./file.controller.js";
import { authGuard } from "../common/authGuard.js";
import { validateBody, validateQuery } from "../common/validate.js";
import { asyncHandler } from "../common/asyncHandler.js";
import {
  initUploadSchema,
  confirmUploadSchema,
  getDownloadUrlSchema,
} from "./file.dto.js";

const router = Router();

// Public download (signed url logic handles security), or protect if needed.
// Authenticated uploads
router.post(
  "/init",
  authGuard,
  validateBody(initUploadSchema),
  asyncHandler(initUpload),
);

router.post(
  "/confirm",
  authGuard,
  validateBody(confirmUploadSchema),
  asyncHandler(confirmUpload),
);

// Protected download url generation usually requires auth to verify access rights
router.get(
  "/download",
  authGuard,
  validateQuery(getDownloadUrlSchema),
  asyncHandler(getDownloadUrl),
);

router.delete("/:key", authGuard, asyncHandler(deleteFile));

export default router;
