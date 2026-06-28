import { describe, it, expect } from "vitest";
import { request, createUser, loginAndGetAccess } from "../helpers/auth.js";
import { sign2faToken } from "../../src/modules/auth/jwt.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";

const url = (path: string, token: string) =>
  `${path}?token=${encodeURIComponent(token)}`;

const bearer = (access: string) => ["Authorization", `Bearer ${access}`] as const;

describe("2FA single-use denylist (Redis)", () => {
  it("verifies email once, then rejects the reused token", async () => {
    const user = await createUser("twofa@test.local", PASSWORD);
    const access = await loginAndGetAccess("twofa@test.local", PASSWORD);
    const token = sign2faToken(user.id, "verify-email");

    const first = await request
      .post(url("/auth/verify-email", token))
      .set("Authorization", `Bearer ${access}`);
    expect(first.status).toBe(200);

    const reuse = await request
      .post(url("/auth/verify-email", token))
      .set("Authorization", `Bearer ${access}`);
    expect(reuse.status).toBe(401);
  });

  it("does NOT consume a token presented to the wrong scope", async () => {
    const user = await createUser("scope@test.local", PASSWORD);
    const access = await loginAndGetAccess("scope@test.local", PASSWORD);
    // reset-password scope'lu token'ı yanlışlıkla verify-email'e sun
    const rpToken = sign2faToken(user.id, "reset-password");

    const wrongScope = await request
      .post(url("/auth/verify-email", rpToken))
      .set("Authorization", `Bearer ${access}`);
    expect(wrongScope.status).toBe(401);

    // Aynı token doğru scope'ta hâlâ geçerli olmalı (yakılmamış)
    const correct = await request
      .post(url("/auth/reset-password", rpToken))
      .set("Authorization", `Bearer ${access}`)
      .send({ newPassword: "another-strong-pw" });
    expect(correct.status).toBe(200);
  });

  it("rejects a token issued for a different user", async () => {
    const owner = await createUser("owner@test.local", PASSWORD);
    await createUser("intruder@test.local", PASSWORD);
    const intruderAccess = await loginAndGetAccess(
      "intruder@test.local",
      PASSWORD
    );
    const ownerToken = sign2faToken(owner.id, "verify-email");

    const res = await request
      .post(url("/auth/verify-email", ownerToken))
      .set("Authorization", `Bearer ${intruderAccess}`);
    expect(res.status).toBe(401);
  });

  it("rejects a 2FA action without an access token (authGuard)", async () => {
    const user = await createUser("noacc@test.local", PASSWORD);
    const token = sign2faToken(user.id, "verify-email");
    const res = await request.post(url("/auth/verify-email", token));
    expect(res.status).toBe(401);
  });
});

describe("POST /auth/2fa (request OTP)", () => {
  it("requires authentication", async () => {
    const res = await request.post("/auth/2fa").send({ scope: "verify-email" });
    expect(res.status).toBe(401);
  });

  it("rejects change-email without newEmail (refine)", async () => {
    await createUser("req1@test.local", PASSWORD);
    const access = await loginAndGetAccess("req1@test.local", PASSWORD);
    const res = await request
      .post("/auth/2fa")
      .set(...bearer(access))
      .send({ scope: "change-email" });
    expect(res.status).toBe(400);
  });

  it("issues an OTP for a valid scope", async () => {
    await createUser("req2@test.local", PASSWORD);
    const access = await loginAndGetAccess("req2@test.local", PASSWORD);
    const res = await request
      .post("/auth/2fa")
      .set(...bearer(access))
      .send({ scope: "reset-password" });
    expect(res.status).toBe(200);
  });
});

describe("verify-email flow", () => {
  it("sets emailVerified=true", async () => {
    const user = await createUser("ve@test.local", PASSWORD);
    const access = await loginAndGetAccess("ve@test.local", PASSWORD);
    const token = sign2faToken(user.id, "verify-email");

    const res = await request
      .post(url("/auth/verify-email", token))
      .set(...bearer(access));
    expect(res.status).toBe(200);

    const me = await request.get("/me").set(...bearer(access));
    expect(me.body.user.emailVerified).toBe(true);
  });
});

describe("reset-password flow", () => {
  it("changes the password and revokes existing sessions", async () => {
    const user = await createUser("rp@test.local", PASSWORD);
    const login = await request
      .post("/auth/login")
      .send({ email: "rp@test.local", password: PASSWORD });
    const access = login.body.access;
    const { refreshToken, deviceId } = login.body.session;
    const token = sign2faToken(user.id, "reset-password");

    const res = await request
      .post(url("/auth/reset-password", token))
      .set(...bearer(access))
      .send({ newPassword: "brand-new-password" });
    expect(res.status).toBe(200);

    // old password no longer works, new one does
    expect(
      (
        await request
          .post("/auth/login")
          .send({ email: "rp@test.local", password: PASSWORD })
      ).status
    ).toBe(401);
    expect(
      (
        await request
          .post("/auth/login")
          .send({ email: "rp@test.local", password: "brand-new-password" })
      ).status
    ).toBe(200);

    // existing refresh session revoked + audit recorded
    const refreshRes = await request
      .post("/auth/refresh")
      .send({ refreshToken, deviceId });
    expect(refreshRes.status).toBe(401);
    const evt = await prisma.authEvent.findMany({
      where: { userId: user.id, type: "PASSWORD_REVOKE" },
    });
    expect(evt.length).toBe(1);
  });
});

describe("change-email flow", () => {
  it("changes the email and resets emailVerified", async () => {
    const user = await createUser("ce@test.local", PASSWORD, {
      emailVerified: true,
    });
    const access = await loginAndGetAccess("ce@test.local", PASSWORD);
    const token = sign2faToken(user.id, "change-email", {
      newEmail: "ce-new@test.local",
    });

    const res = await request
      .post(url("/auth/change-email", token))
      .set(...bearer(access));
    expect(res.status).toBe(200);

    const me = await request.get("/me").set(...bearer(access));
    expect(me.body.user.email).toBe("ce-new@test.local");
    expect(me.body.user.emailVerified).toBe(false);
  });

  it("rejects changing to an already-used email", async () => {
    await createUser("taken@test.local", PASSWORD);
    const user = await createUser("ce2@test.local", PASSWORD);
    const access = await loginAndGetAccess("ce2@test.local", PASSWORD);
    const token = sign2faToken(user.id, "change-email", {
      newEmail: "taken@test.local",
    });

    const res = await request
      .post(url("/auth/change-email", token))
      .set(...bearer(access));
    expect(res.status).toBe(409);
  });
});
