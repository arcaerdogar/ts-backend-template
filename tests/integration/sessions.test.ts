import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { request, createUser } from "../helpers/auth.js";

const PASSWORD = "super-secret-pw";

async function login(email: string) {
  const res = await request
    .post("/auth/login")
    .send({ email, password: PASSWORD });
  return res.body.session as { refreshToken: string; deviceId: string };
}

const refresh = (refreshToken: string, deviceId: string) =>
  request.post("/auth/refresh").send({ refreshToken, deviceId });

describe("refresh token rotation (Redis)", () => {
  it("rotates and lets the new token refresh again", async () => {
    await createUser("rot@test.local", PASSWORD);
    const s = await login("rot@test.local");

    const r1 = await refresh(s.refreshToken, s.deviceId);
    expect(r1.status).toBe(200);
    expect(r1.body.newRaw).toBeTruthy();

    const r2 = await refresh(r1.body.newRaw, s.deviceId);
    expect(r2.status).toBe(200);
  });

  it("detects reuse: replaying a rotated token kills the whole family", async () => {
    await createUser("reuse@test.local", PASSWORD);
    const s = await login("reuse@test.local");

    const r1 = await refresh(s.refreshToken, s.deviceId);
    expect(r1.status).toBe(200);
    const newRaw = r1.body.newRaw;

    // Eski (zaten döndürülmüş) token tekrar sunulur -> reuse
    const replay = await refresh(s.refreshToken, s.deviceId);
    expect(replay.status).toBe(401);

    // Aile düşürüldüğü için yeni token da artık geçersiz
    const after = await refresh(newRaw, s.deviceId);
    expect(after.status).toBe(401);
  });

  it("rejects refresh from a mismatched device", async () => {
    await createUser("dev@test.local", PASSWORD);
    const s = await login("dev@test.local");
    const res = await refresh(s.refreshToken, randomUUID());
    expect(res.status).toBe(401);
  });

  it("logout revokes the session", async () => {
    await createUser("lo@test.local", PASSWORD);
    const s = await login("lo@test.local");
    await request.post("/auth/logout").send({ refreshToken: s.refreshToken });
    const res = await refresh(s.refreshToken, s.deviceId);
    expect(res.status).toBe(401);
  });
});
