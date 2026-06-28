import supertest from "supertest";
import argon2 from "argon2";
import server from "../../src/server.js";
import { prisma } from "../../src/config/db.js";

export const request = supertest(server);

/** Test kullanıcısını doğrudan DB'ye yazar (register rate limit'ini atlamak için). */
export async function createUser(
  email: string,
  password: string,
  opts: {
    suspended?: boolean;
    emailVerified?: boolean;
    firstName?: string;
    lastName?: string;
  } = {}
) {
  const passwordHash = await argon2.hash(password);
  // Her user'ın bir profili olmak zorunda -> nested create.
  return prisma.user.create({
    data: {
      email: email.trim().toLowerCase(),
      passwordHash,
      isSuspended: opts.suspended ?? false,
      emailVerified: opts.emailVerified ?? false,
      profile: {
        create: {
          firstName: opts.firstName ?? "Test",
          lastName: opts.lastName ?? "User",
        },
      },
    },
  });
}

/** Login olur ve access token'ı döner. */
export async function loginAndGetAccess(email: string, password: string) {
  const res = await request.post("/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login failed (${res.status}): ${JSON.stringify(res.body)}`);
  }
  return res.body.access as string;
}

/** Root admin token'ı (env credentials) alır. */
export async function getRootToken() {
  const res = await request.post("/root/login").send({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
  });
  if (res.status !== 200) {
    throw new Error(`root login failed (${res.status})`);
  }
  return res.body.access as string;
}
