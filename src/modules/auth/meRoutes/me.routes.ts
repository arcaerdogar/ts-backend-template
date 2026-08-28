import { Router } from "express";
import { authGuard, twoFactorAuthGuard } from "../../common/authGuard.js";
import { asyncHandler } from "../../common/asyncHandler.js";
import { validateBody } from "../../common/validate.js";
import {
  getSelfInfo,
  updateProfileHandler,
  setProfilePhotoHandler,
  deleteSelfHandler,
  registerFcmTokenHandler,
} from "./me.controllers.js";
import {
  updateProfileSchema,
  setProfilePhotoSchema,
  fcmTokenRegistrationSchema,
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

// Push bildirimi için cihazın FCM token'ını kaydeder/günceller.
r.post(
  "/fcm-tokens",
  authGuard,
  validateBody(fcmTokenRegistrationSchema),
  asyncHandler(registerFcmTokenHandler)
);

// Kalıcı hesap silme. 2FA (delete-account scope) OTP'si ?token= ile gelir.
r.delete(
  "/",
  authGuard,
  twoFactorAuthGuard("delete-account"),
  asyncHandler(deleteSelfHandler)
);

export default r;
