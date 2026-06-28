import { describe, it, expect } from "vitest";
import { request, createUser, loginAndGetAccess } from "../helpers/auth.js";
import { sign2faToken } from "../../src/modules/auth/jwt.js";

const PASSWORD = "super-secret-pw";

const url = (path: string, token: string) =>
  `${path}?token=${encodeURIComponent(token)}`;

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
});
