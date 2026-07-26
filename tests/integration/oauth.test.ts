import { describe, it, expect, beforeEach, vi } from "vitest";
import type { OAuthIdentity } from "../../src/modules/auth/oauth/providers/provider.interface.js";

// Google provider'ı mock'la: dış ağ (token endpoint + JWKS) çağrısı YOK.
// getAuthorizeUrl state'i URL'e koyar ki testte geri okuyabilelim; exchangeCode
// sabit bir kimlik döndürür.
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
    getAuthorizeUrl: ({ state }: { state: string }) =>
      `https://accounts.google.com/o/oauth2/v2/auth?state=${encodeURIComponent(state)}`,
    exchangeCode: async () => holder.identity,
  },
}));

// server importu mock'tan SONRA olmalı (helpers/auth server'ı içeri alır).
const { request } = await import("../helpers/auth.js");
const { prisma } = await import("../../src/config/db.js");

async function start(): Promise<string> {
  const res = await request.post("/auth/oauth/google/start").send({});
  expect(res.status).toBe(200);
  const url = new URL(res.body.authorizeUrl);
  return url.searchParams.get("state")!;
}

describe("OAuth Google callback + exchange (happy path)", () => {
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

  it("start returns an authorize URL carrying state", async () => {
    const res = await request.post("/auth/oauth/google/start").send({});
    expect(res.status).toBe(200);
    expect(res.body.authorizeUrl).toContain("state=");
  });

  it("callback issues a one-time exchange code; exchange returns a login-shaped session", async () => {
    const state = await start();

    const cb = await request.get(
      `/auth/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    expect(cb.status).toBe(302);
    const location = cb.headers["location"] as string;
    expect(location.startsWith("http://localhost:5173/oauth/callback")).toBe(true);
    const exchangeCode = new URL(location).searchParams.get("exchange")!;
    expect(exchangeCode).toBeTruthy();

    // Yeni kullanıcı oluşmuş olmalı (REGISTERED) + audit.
    const user = await prisma.user.findUnique({
      where: { email: "happy@test.local" },
      include: { oauthAccounts: true },
    });
    expect(user).not.toBeNull();
    expect(user!.oauthAccounts).toHaveLength(1);
    const evt = await prisma.authEvent.findMany({
      where: { userId: user!.id, type: "OAUTH_REGISTER" },
    });
    expect(evt.length).toBe(1);

    // exchange -> login endpoint'iyle aynı şekil.
    const ex = await request
      .post("/auth/oauth/exchange")
      .send({ exchangeCode });
    expect(ex.status).toBe(200);
    expect(ex.body.user.userId).toBe(user!.id);
    expect(ex.body.user.email).toBe("happy@test.local");
    expect(ex.body.access).toBeTruthy();
    expect(ex.body.session.refreshToken).toBeTruthy();
    expect(ex.body.session.deviceId).toBeTruthy();
    expect(ex.body.session.expiresAt).toBeTruthy();

    // Tek kullanımlık: exchange kodu ikinci kez reddedilir (replay).
    const replay = await request
      .post("/auth/oauth/exchange")
      .send({ exchangeCode });
    expect(replay.status).toBe(400);
    expect(replay.body.error).toBe("OAUTH_EXCHANGE_INVALID");
  });

  it("rejects a callback with an unknown/expired state (OAUTH_STATE_MISMATCH + audit)", async () => {
    const cb = await request.get(
      `/auth/oauth/google/callback?code=auth-code&state=this-state-was-never-issued`
    );
    expect(cb.status).toBe(400);
    expect(cb.body.error).toBe("OAUTH_STATE_MISMATCH");

    const evt = await prisma.authEvent.findMany({
      where: { type: "OAUTH_STATE_MISMATCH" },
    });
    expect(evt.length).toBe(1);
  });

  it("re-uses the same state only once (consumed on first callback)", async () => {
    const state = await start();

    const first = await request.get(
      `/auth/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    expect(first.status).toBe(302);

    // Aynı state ikinci kez -> tüketildiği için mismatch.
    const second = await request.get(
      `/auth/oauth/google/callback?code=auth-code&state=${encodeURIComponent(state)}`
    );
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("OAUTH_STATE_MISMATCH");
  });
});
