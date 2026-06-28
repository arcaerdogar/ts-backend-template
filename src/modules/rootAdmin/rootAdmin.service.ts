import { env } from "../../config/env.js";
import { signRootToken } from "../auth/jwt.js";
import { HttpError } from "../common/errors.js";
import { updateSystemAdminRole } from "../auth/users.service.js";

/**
 * Root admin girişi. Kimlik bilgileri env'deki ADMIN_EMAIL/ADMIN_PASSWORD ile
 * birebir eşleşmelidir. Başarılıysa scope'u "root" olan kısa ömürlü bir JWT döner.
 */
export const loginAsRoot = async (email: string, password: string) => {
  if (email !== env.admin.email || password !== env.admin.password) {
    throw HttpError.unauthorized("Invalid root credentials.");
  }

  return { accessToken: signRootToken() };
};

/** Bir kullanıcıya SYSTEM_ADMIN rolü atar veya alır. */
export const manageSystemAdmin = (userId: string, assign: boolean) =>
  updateSystemAdminRole(userId, assign);
