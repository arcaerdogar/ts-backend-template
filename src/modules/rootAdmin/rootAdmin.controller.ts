import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { loginAsRoot, manageSystemAdmin } from "./rootAdmin.service.js";

export const login = async (req: Request, res: Response) => {
  const { email, password } = req.body;
  const { accessToken } = await loginAsRoot(email, password);

  res.cookie(env.cookies.rootAccessName, accessToken, {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: "lax",
    maxAge: env.jwt.rootExpiresMin * 60 * 1000,
    path: "/",
  });

  // Cookie kullanmayan istemciler (örn. mobil/CLI) için token'ı da döndürürüz.
  res.json({ ok: true, access: accessToken });
};

export const logout = async (_req: Request, res: Response) => {
  res.clearCookie(env.cookies.rootAccessName, {
    httpOnly: true,
    secure: env.cookies.secure,
    sameSite: "lax",
    path: "/",
  });
  res.json({ ok: true });
};

export const manageSystemAdminHandler = async (
  req: Request,
  res: Response
) => {
  const { userId, assign } = req.body;
  const result = await manageSystemAdmin(userId, assign);
  res.json(result);
};
