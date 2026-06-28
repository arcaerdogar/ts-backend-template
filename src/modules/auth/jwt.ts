import jwt from "jsonwebtoken";
import { env } from "../../config/env.js";

type AccessPayload = {
  sub: string;
  iat?: number;
  exp?: number;
};
type TwoFactorPayload = {
  sub: string;
  scope: string;
  newEmail?: string;
  iat?: number;
  exp: number;
};

type RootPayload = {
  sub: "root";
  scope: "root";
  iat?: number;
  exp: number;
};

export const signAccessToken = (userId: string) => {
  return jwt.sign({ sub: userId }, env.jwt.secret, {
    expiresIn: `${env.jwt.accessExpiresMin}m`,
  });
};

export function verifyAccessToken(token: string) {
  return jwt.verify(token, env.jwt.secret) as AccessPayload;
}

export const sign2faToken = (
  userId: string,
  scope: string,
  extra?: Record<string, unknown>
) => {
  return jwt.sign({ sub: userId, scope, ...extra }, env.jwt.twoFactorSecret, {
    expiresIn: `${env.jwt.twoFactorExpiresMin}m`,
  });
};

export const verify2faToken = (token: string) => {
  return jwt.verify(token, env.jwt.twoFactorSecret) as TwoFactorPayload;
};

export const signRootToken = () => {
  return jwt.sign({ sub: "root", scope: "root" }, env.jwt.secret, {
    expiresIn: `${env.jwt.rootExpiresMin}m`,
  });
};

export const verifyRootToken = (token: string) => {
  return jwt.verify(token, env.jwt.secret) as RootPayload;
};
