import type { Request, Response } from "express";
import { getUserInfo } from "../users.service.js";
import { updateProfile, setProfilePhoto } from "../profile.service.js";

export const getSelfInfo = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { sessions, profile, ...user } = await getUserInfo(userId);
  res.status(200).json({ user, profile, sessions });
};

export const updateProfileHandler = async (req: Request, res: Response) => {
  const profile = await updateProfile(req.user!.id, (req as any).body);
  res.status(200).json({ profile });
};

export const setProfilePhotoHandler = async (req: Request, res: Response) => {
  const { fileId } = (req as any).body;
  const profile = await setProfilePhoto(req.user!.id, fileId);
  res.status(200).json({ profile });
};
