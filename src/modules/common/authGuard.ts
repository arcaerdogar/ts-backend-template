import { type Request, type Response, type NextFunction } from "express";
import {
  verify2faToken,
  verifyAccessToken,
  verifyRootToken,
} from "../auth/jwt.js";
import { HttpError } from "./errors.js";
import { createHash } from "crypto";
import { prisma } from "../../config/db.js";
import { RoleName } from "@prisma/client";
import { env } from "../../config/env.js";

function readBearer(req: Request): string | undefined {
  const h = req.headers.authorization || "";
  return h.startsWith("Bearer ") ? h.slice(7) : undefined;
}

/** Root JWT'yi HttpOnly cookie'den ya da `Authorization: Bearer`'dan okur. */
export function getRootTokenFromRequest(req: Request): string | undefined {
  const fromCookie = req.cookies?.[env.cookies.rootAccessName] as
    | string
    | undefined;
  if (fromCookie) return fromCookie;
  return readBearer(req);
}

/** Sadece root admin (env credentials) erişimine izin verir. */
export function rootAuthGuard(req: Request, res: Response, next: NextFunction) {
  const token = getRootTokenFromRequest(req);
  if (!token) throw HttpError.unauthorized("No token provided.");
  try {
    const payload = verifyRootToken(token);
    if (payload.sub !== "root" || payload.scope !== "root") {
      throw new Error("Invalid root token");
    }
    req.user = { id: "root", role: "root" };
    next();
  } catch {
    throw HttpError.unauthorized("You are not authorized for this action");
  }
}

export type RoleAuthGuardOptions = {
  /** true ise root JWT ile gelen istekler rol kontrolünü atlar. */
  allowRoot?: boolean;
};

/**
 * Kullanıcının verilen rollerden en az birine sahip olmasını şart koşar.
 * `authGuard` veya `adminRouteAuthGuard` ile zincirlenmelidir.
 */
export function roleAuthGuard(
  allowedRoles: RoleName[],
  options?: RoleAuthGuardOptions
) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const user = req.user;
    if (!user || !user.id) {
      throw HttpError.unauthorized("User not authenticated.");
    }

    if (options?.allowRoot === true && user.role === "root") {
      return next();
    }

    if (user.id === "root") {
      throw HttpError.forbidden("Insufficient permissions.");
    }

    const userWithRoles = await prisma.user.findUnique({
      where: { id: user.id },
      include: { roles: true },
    });
    if (!userWithRoles) throw HttpError.unauthorized("User not found.");

    const userRoles = userWithRoles.roles.map((r) => r.role);
    const hasRole = userRoles.some((r) => allowedRoles.includes(r));
    if (!hasRole) throw HttpError.forbidden("Insufficient permissions.");

    next();
  };
}

/**
 * Admin route'ları: normal access JWT (Bearer) veya root JWT
 * (Bearer ya da HttpOnly cookie) ile erişime izin verir.
 */
export function adminRouteAuthGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const bearer = readBearer(req);
  if (bearer) {
    try {
      const payload = verifyAccessToken(bearer);
      req.user = { id: payload.sub };
      return next();
    } catch {
      try {
        const payload = verifyRootToken(bearer);
        if (payload.sub === "root" && payload.scope === "root") {
          req.user = { id: "root", role: "root" };
          return next();
        }
      } catch {
        /* cookie'ye düş */
      }
    }
  }

  const cookieTok = req.cookies?.[env.cookies.rootAccessName] as
    | string
    | undefined;
  if (cookieTok) {
    try {
      const payload = verifyRootToken(cookieTok);
      if (payload.sub === "root" && payload.scope === "root") {
        req.user = { id: "root", role: "root" };
        return next();
      }
    } catch {
      /* noop */
    }
  }

  throw HttpError.unauthorized("You are not authorized for this action");
}

export function authGuard(req: Request, res: Response, next: NextFunction) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw HttpError.unauthorized("No token provided.");
  try {
    const payload = verifyAccessToken(token);
    req.user = {
      id: payload.sub,
    };
    next();
  } catch {
    throw HttpError.unauthorized("You are not authorized for this action");
  }
}

export function twoFactorAuthGuard(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token as string;
    try {
      if (!token) throw HttpError.unauthorized("No 2FA token provided.");
      const payload = verify2faToken(token);
      const tokenHash = createHash("sha256").update(token).digest("hex");
      const existingToken = await prisma.expiredTwoFactorToken.findUnique({
        where: { tokenHash },
      });

      if (existingToken) {
        throw HttpError.unauthorized("Token used.");
      }

      await prisma.expiredTwoFactorToken.create({
        data: {
          userId: payload.sub,
          tokenHash,
          usedAt: new Date(),
          expiresAt: new Date(payload.exp * 1000),
        },
      });
      const userId = req.user!.id;
      if (payload.sub !== userId) {
        throw HttpError.unauthorized("This token wasn't issued for you.");
      }
      if (payload.scope !== scope)
        throw HttpError.unauthorized(
          "This token wasn't issued for this action."
        );

      next();
    } catch (err) {
      throw HttpError.unauthorized("Two factor authentication failed.");
    }
  };
}
