import { prisma } from "../../config/db.js";
import { HttpError } from "../common/errors.js";
import { revokeAll } from "./refresh.js";
import { RoleName } from "@prisma/client";
import argon2 from "argon2";

/** Hesap kilitlenmeden önce izin verilen ardışık hatalı giriş sayısı. */
const MAX_FAILED_LOGINS = 5;
/** Kilit süresi (dakika). */
const LOCK_DURATION_MIN = 15;

export const createUser = async (emailRaw: string, passwordRaw: string) => {
  const email = emailRaw.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists)
    throw HttpError.conflict("This email is already in use.", "EMAIL_IN_USE");

  const passwordHash = await argon2.hash(passwordRaw);

  const user = await prisma.user.create({ data: { email, passwordHash } });

  return user;
};

export async function verifyUser(emailRaw: string, password: string) {
  const email = emailRaw.trim().toLowerCase();
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user)
    throw HttpError.unauthorized(
      "Email or password is incorrect.",
      "INVALID_CREDENTIALS"
    );

  if (user.isSuspended)
    throw HttpError.forbidden("Account suspended.", "ACCOUNT_SUSPENDED");

  if (user.lockUntil && user.lockUntil > new Date())
    throw HttpError.forbidden(
      "Account locked due to too many failed login attempts.",
      "ACCOUNT_LOCKED"
    );

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    const { failedLoginCount } = await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
      select: { failedLoginCount: true },
    });

    if (failedLoginCount >= MAX_FAILED_LOGINS) {
      await prisma.user.update({
        where: { id: user.id },
        data: {
          lockUntil: new Date(Date.now() + LOCK_DURATION_MIN * 60 * 1000),
        },
      });
    }

    throw HttpError.unauthorized(
      "Email or password is incorrect.",
      "INVALID_CREDENTIALS"
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lockUntil: null, lastLoginAt: new Date() },
  });

  return { id: user.id, email: user.email };
}

export const getUserInfo = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      lastLoginAt: true,
      emailVerified: true,
      refreshTokens: {
        where: { revoked: false },
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          userAgent: true,
          ip: true,
          deviceId: true,
          createdAt: true,
          expiresAt: true,
        },
      },
    },
  });
  if (!user) throw HttpError.notFound("User not found.");
  return user;
};

export const verifyUserEmail = async (userId: string) => {
  const verifiedUser = await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });
  return verifiedUser;
};

export const resetUserPassword = async (
  userId: string,
  newPassword: string
) => {
  const newRaw = await argon2.hash(newPassword);
  const updatedUser = prisma.user.update({
    where: { id: userId },
    data: { passwordHash: newRaw, passwordChangedAt: new Date() },
  });
  return updatedUser;
};

export const updateUserEmail = async (userId: string, newEmailRaw: string) => {
  const newEmail = newEmailRaw.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email: newEmail } });
  if (exists)
    throw HttpError.conflict("This email is already in use.", "EMAIL_IN_USE");

  const updatedUser = await prisma.user.update({
    where: { id: userId },
    data: { email: newEmail, emailVerified: false },
  });
  return updatedUser;
};

/* -------------------------------------------------------------------------- */
/*                            Admin (SystemAdmin)                             */
/* -------------------------------------------------------------------------- */

const adminUserSelect = {
  id: true,
  email: true,
  emailVerified: true,
  isSuspended: true,
  lockUntil: true,
  failedLoginCount: true,
  lastLoginAt: true,
  createdAt: true,
  roles: { select: { role: true } },
} as const;

export async function listUsersPaginated(opts: {
  page: number;
  limit: number;
  q?: string | undefined;
}) {
  const search = opts.q?.trim();
  const where =
    search && search.length > 0
      ? { email: { contains: search, mode: "insensitive" as const } }
      : {};

  const skip = (opts.page - 1) * opts.limit;
  const [total, items] = await prisma.$transaction([
    prisma.user.count({ where }),
    prisma.user.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip,
      take: opts.limit,
      select: adminUserSelect,
    }),
  ]);

  return { items, total, page: opts.page, limit: opts.limit };
}

export const getUserByIdForAdmin = async (userId: string) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      ...adminUserSelect,
      passwordChangedAt: true,
      refreshTokens: {
        where: { revoked: false },
        take: 20,
        orderBy: { createdAt: "desc" },
        select: {
          userAgent: true,
          ip: true,
          deviceId: true,
          createdAt: true,
          expiresAt: true,
        },
      },
    },
  });
  if (!user) throw HttpError.notFound("User not found.");
  return user;
};

/**
 * Bir kullanıcıyı askıya alır veya askıyı kaldırır.
 * Askıya alındığında tüm aktif refresh oturumları iptal edilir.
 */
export const setUserSuspended = async (
  userId: string,
  suspended: boolean
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw HttpError.notFound("User not found.");

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { isSuspended: suspended },
    select: { id: true, email: true, isSuspended: true },
  });

  if (suspended) await revokeAll(userId);

  return updated;
};

export const updateSystemAdminRole = async (
  userId: string,
  assign: boolean
) => {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user) throw HttpError.notFound("User not found.");

  if (assign) {
    await prisma.hasRole.upsert({
      where: { userId_role: { userId, role: RoleName.SYSTEM_ADMIN } },
      create: { userId, role: RoleName.SYSTEM_ADMIN },
      update: {},
    });
  } else {
    await prisma.hasRole.deleteMany({
      where: { userId, role: RoleName.SYSTEM_ADMIN },
    });
  }

  return { success: true };
};
