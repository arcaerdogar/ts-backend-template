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

export const sign2faToken = (userId: string, scope: string) => {
  return jwt.sign({ sub: userId, scope }, env.jwt.secret, {
    expiresIn: `${env.jwt.twoFactorExpiresMin}m`,
  });
};

export const verify2faToken = (token: string) => {
  return jwt.verify(token, env.jwt.secret) as TwoFactorPayload;
};
