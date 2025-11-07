import { type Request, type Response, type NextFunction } from "express";
import { verifyAccessToken } from "../auth/jwt.js";
import { HttpError } from "./errors.js";

export function authGuard(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) return res.status(401).json({ error: "no_token" });
  try {
    const payload = verifyAccessToken(token);
    (req as any).user = {
      id: payload.sub,
    };
    next();
  } catch {
    throw HttpError.unauthorized("You are not authorized for this action");
  }
}
