import { Router } from "express";
import { authGuard } from "../../common/authGuard.js";
import { asyncHandler } from "../../common/asyncHandler.js";
import { validateBody } from "../../common/validate.js";
import {
  getSelfInfo,
  updateProfileHandler,
  setProfilePhotoHandler,
} from "./me.controllers.js";
import {
  updateProfileSchema,
  setProfilePhotoSchema,
} from "./me.validators.js";

const r = Router();

r.get("/", authGuard, asyncHandler(getSelfInfo));

r.patch(
  "/profile",
  authGuard,
  validateBody(updateProfileSchema),
  asyncHandler(updateProfileHandler)
);

// Önceden /files/init + /files/confirm ile yüklenip File varlığı oluşturulmuş
// bir profil fotoğrafını profile bağlar.
r.put(
  "/profile/photo",
  authGuard,
  validateBody(setProfilePhotoSchema),
  asyncHandler(setProfilePhotoHandler)
);

export default r;
