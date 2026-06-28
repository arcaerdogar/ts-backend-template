import { type Request, type Response, type NextFunction } from "express";
import {
  verify2faToken,
  verifyAccessToken,
  verifyRootToken,
} from "../auth/jwt.js";
import { HttpError } from "./errors.js";
import { prisma } from "../../config/db.js";
import { RoleName } from "@prisma/client";
import { env } from "../../config/env.js";
import { claimTwoFactorToken } from "../auth/twoFactorDenylist.js";
import { recordAuthEvent } from "../auth/authEvent.js";
import { isUserBlocked } from "../auth/blocklist.js";

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
export async function adminRouteAuthGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const bearer = readBearer(req);
  if (bearer) {
    // Önce normal access token; geçerliyse blocklist kontrolü yapılır.
    let accessPayload: { sub: string } | null = null;
    try {
      accessPayload = verifyAccessToken(bearer);
    } catch {
      accessPayload = null;
    }
    if (accessPayload) {
      if (await isUserBlocked(accessPayload.sub))
        throw HttpError.unauthorized("Session revoked.");
      req.user = { id: accessPayload.sub };
      return next();
    }

    // Access token değilse root token olarak dene.
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

export async function authGuard(
  req: Request,
  res: Response,
  next: NextFunction
) {
  const h = req.headers.authorization || "";
  const token = h.startsWith("Bearer ") ? h.slice(7) : "";
  if (!token) throw HttpError.unauthorized("No token provided.");

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch {
    throw HttpError.unauthorized("You are not authorized for this action");
  }

  // Stateless JWT'nin anlık-iptal boşluğunu kapatır (suspend/delete sonrası).
  if (await isUserBlocked(payload.sub))
    throw HttpError.unauthorized("Session revoked.");

  req.user = { id: payload.sub };
  next();
}

export function twoFactorAuthGuard(scope: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const token = req.query.token as string;
    if (!token) throw HttpError.unauthorized("No 2FA token provided.");

    let payload;
    try {
      payload = verify2faToken(token);
    } catch {
      throw HttpError.unauthorized("Two factor authentication failed.");
    }

    // Token'ı tüketmeden ÖNCE sahiplik ve scope doğrulanır; aksi halde yanlış
    // scope'lu geçerli bir token boşa "kullanıldı" olarak yakılırdı.
    if (payload.sub !== req.user!.id) {
      await recordAuthEvent({
        type: "TWO_FA_FAILED",
        userId: req.user!.id,
        ip: req.ip,
        meta: { scope, reason: "wrong_user" },
      });
      throw HttpError.unauthorized("This token wasn't issued for you.");
    }
    if (payload.scope !== scope) {
      await recordAuthEvent({
        type: "TWO_FA_FAILED",
        userId: payload.sub,
        ip: req.ip,
        meta: { scope, tokenScope: payload.scope, reason: "wrong_scope" },
      });
      throw HttpError.unauthorized("This token wasn't issued for this action.");
    }

    // Atomik tek-kullanımlık tüketim (Redis SET NX EX).
    const claimed = await claimTwoFactorToken(token, payload.exp);
    if (!claimed) {
      await recordAuthEvent({
        type: "TWO_FA_FAILED",
        userId: payload.sub,
        ip: req.ip,
        meta: { scope, reason: "token_used" },
      });
      throw HttpError.unauthorized("Token used.");
    }

    await recordAuthEvent({
      type: "TWO_FA_VERIFIED",
      userId: payload.sub,
      ip: req.ip,
      meta: { scope },
    });
    next();
  };
}
