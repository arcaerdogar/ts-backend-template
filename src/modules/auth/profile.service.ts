import { FilePurpose } from "@prisma/client";
import { prisma } from "../../config/db.js";
import { HttpError } from "../common/errors.js";
import { storageService } from "../../services/storage/s3.service.js";

const profileSelect = {
  firstName: true,
  lastName: true,
  photoFile: { select: { key: true } },
} as const;

type ProfileRow = {
  firstName: string;
  lastName: string;
  photoFile: { key: string } | null;
};

/** Profil satırını dışa açık bir görünüme çevirir (foto -> public URL). */
export function toProfileView(p: ProfileRow | null) {
  if (!p) return null;
  return {
    firstName: p.firstName,
    lastName: p.lastName,
    photoUrl: p.photoFile ? storageService.getPublicUrl(p.photoFile.key) : null,
  };
}

export async function updateProfile(
  userId: string,
  data: { firstName?: string | undefined; lastName?: string | undefined }
) {
  const updated = await prisma.profile.update({
    where: { userId },
    data: {
      ...(data.firstName !== undefined ? { firstName: data.firstName.trim() } : {}),
      ...(data.lastName !== undefined ? { lastName: data.lastName.trim() } : {}),
    },
    select: profileSelect,
  });
  return toProfileView(updated);
}

/**
 * Önceden confirm edilmiş bir File'ı (purpose=PROFILE_PHOTO) profile bağlar.
 * Dosya felsefesi: profil ham URL değil, files tablosundaki bir varlığa referans
 * tutar. Eski fotoğraf varsa soft-delete edilir.
 */
export async function setProfilePhoto(userId: string, fileId: string) {
  const file = await prisma.file.findUnique({ where: { id: fileId } });
  if (!file || !file.isActive) throw HttpError.notFound("File not found.");
  if (file.userId !== userId) throw HttpError.forbidden("Unauthorized");
  if (file.purpose !== FilePurpose.PROFILE_PHOTO)
    throw HttpError.badRequest("File is not a profile photo.");

  const current = await prisma.profile.findUnique({
    where: { userId },
    select: { photoFileId: true },
  });

  const updated = await prisma.profile.update({
    where: { userId },
    data: { photoFileId: fileId },
    select: profileSelect,
  });

  // Değiştirilen eski fotoğrafı pasifleştir (soft-delete).
  if (current?.photoFileId && current.photoFileId !== fileId) {
    await prisma.file.update({
      where: { id: current.photoFileId },
      data: { isActive: false },
    });
  }

  return toProfileView(updated);
}
