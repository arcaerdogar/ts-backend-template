import { FilePurpose } from "@prisma/client";

export function getFolderByPurpose(purpose: FilePurpose): string {
  switch (purpose) {
    case FilePurpose.PROFILE_PHOTO:
      return "profile-photos";
    case FilePurpose.POST_ATTACHMENT:
      return "attachments";
    case FilePurpose.DOCUMENT:
      return "documents";
    case FilePurpose.TEST_FILE:
      return "test-files";
    case FilePurpose.OTHER:
    default:
      return "others";
  }
}

export function getPurposeByFolder(folder: string): FilePurpose {
  switch (folder) {
    case "profile-photos":
      return FilePurpose.PROFILE_PHOTO;
    case "attachments":
      return FilePurpose.POST_ATTACHMENT;
    case "documents":
      return FilePurpose.DOCUMENT;
    case "test-files":
      return FilePurpose.TEST_FILE;
    default:
      return FilePurpose.OTHER;
  }
}

export function slugifyFilename(filename: string): string {
  return filename
    .toLowerCase()
    .replace(/[^a-z0-9.]/g, "-") // Replace non-alphanumeric (except dot) with dash
    .replace(/-+/g, "-") // Collapse dashes
    .replace(/^-|-$/g, ""); // Trim dashes
}
