import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OAuthIdentity } from "../../src/modules/auth/oauth/providers/provider.interface.js";

// Google provider'ı mock'la: dış ağ (token endpoint + JWKS) çağrısı YOK.
// exchangeCode, app'in getirdiği code/verifier/nonce'a karşılık sabit bir
// kimlik döndürür. App-driven akışta backend authorize URL'i KURMAZ.
const holder = vi.hoisted(() => ({
  identity: {
    provider: "GOOGLE",
    providerAccountId: "google-sub-happy",
    email: "happy@test.local",
    emailVerified: true,
    firstName: "Ha",
    lastName: "Ppy",
  } as OAuthIdentity,
}));

vi.mock("../../src/modules/auth/oauth/providers/google.provider.js", () => ({
  googleProvider: {
    provider: "GOOGLE",
    exchangeCode: async () => holder.identity,
  },
}));

// server importu mock'tan SONRA olmalı (helpers/auth server'ı içeri alır).
const { request } = await import("../helpers/auth.js");
const { prisma } = await import("../../src/config/db.js");

const body = { code: "auth-code", codeVerifier: "verifier", nonce: "nonce" };

describe("OAuth Google (app-driven, single endpoint)", () => {
  beforeEach(() => {
    holder.identity = {
      provider: "GOOGLE",
      providerAccountId: "google-sub-happy",
      email: "happy@test.local",
      emailVerified: true,
      firstName: "Ha",
      lastName: "Ppy",
    };
  });

  it("new sub -> REGISTERED: creates user+profile+oauthAccount, returns login-shaped session", async () => {
    const res = await request.post("/auth/oauth/google").send(body);
    expect(res.status).toBe(200);

    // login endpoint'iyle BİREBİR aynı şekil.
    expect(res.body.user.email).toBe("happy@test.local");
    expect(res.body.user.userId).toBeTruthy();
    expect(res.body.access).toBeTruthy();
    expect(res.body.session.refreshToken).toBeTruthy();
    expect(res.body.session.deviceId).toBeTruthy();
    expect(res.body.session.expiresAt).toBeTruthy();

    const user = await prisma.user.findUnique({
      where: { email: "happy@test.local" },
      include: { oauthAccounts: true },
    });
    expect(user).not.toBeNull();
    expect(user!.passwordHash).toBeNull(); // OAuth-only: şifre yok
    expect(user!.oauthAccounts).toHaveLength(1);

    const evt = await prisma.authEvent.findMany({
      where: { userId: user!.id, type: "OAUTH_REGISTER" },
    });
    expect(evt.length).toBe(1);
  });

  it("same sub again -> LOGGED_IN: no duplicate user, OAUTH_LOGIN audit", async () => {
    await request.post("/auth/oauth/google").send(body);
    const res = await request.post("/auth/oauth/google").send(body);
    expect(res.status).toBe(200);

    const users = await prisma.user.findMany({
      where: { email: "happy@test.local" },
    });
    expect(users).toHaveLength(1);

    const evt = await prisma.authEvent.findMany({
      where: { userId: users[0]!.id, type: "OAUTH_LOGIN" },
    });
    expect(evt.length).toBe(1);
  });

  it("validates body: missing codeVerifier -> 400", async () => {
    const res = await request
      .post("/auth/oauth/google")
      .send({ code: "auth-code", nonce: "nonce" });
    expect(res.status).toBe(400);
  });
});
