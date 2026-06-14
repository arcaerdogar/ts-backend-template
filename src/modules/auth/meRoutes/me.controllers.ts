import type { Request, Response } from "express";
import { getUserInfo } from "../users.service.js";

export const getSelfInfo = async (req: Request, res: Response) => {
  const userId = req.user!.id;
  const { refreshTokens, ...user } = await getUserInfo(userId);
  res.status(200).json({ user, sessions: refreshTokens });
};
