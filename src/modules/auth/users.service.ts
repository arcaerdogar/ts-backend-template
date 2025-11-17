import { prisma } from "../../config/db.js";
import { HttpError } from "../common/errors.js";
import argon2 from "argon2";

export const createUser = async (emailRaw: string, passwordRaw: string) => {
  const email = emailRaw.trim().toLowerCase();
  const exists = await prisma.user.findUnique({ where: { email } });
  if (exists)
    throw HttpError.conflict("EMAIL_IN_USE", "This email is already in use.");

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

  const ok = await argon2.verify(user.passwordHash, password);
  if (!ok) {
    await prisma.user.update({
      where: { id: user.id },
      data: { failedLoginCount: { increment: 1 } },
    });
    throw HttpError.unauthorized(
      "Email or password is incorrect.",
      "INVALID_CREDENTIALS"
    );
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { failedLoginCount: 0, lastLoginAt: new Date() },
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
    data: { passwordHash: newRaw },
  });
  return updatedUser;
};
