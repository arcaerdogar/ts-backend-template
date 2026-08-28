import { describe, it, expect } from "vitest";
import {
  request,
  createUser,
  loginAndGetAccess,
} from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";
const DEVICE_A = "11111111-1111-4111-8111-111111111111";
const DEVICE_B = "22222222-2222-4222-8222-222222222222";

/** SYSTEM_ADMIN rolüne sahip bir kullanıcı oluşturup access token'ını döner. */
async function createAdminAndLogin(email: string) {
  const admin = await createUser(email, PASSWORD);
  await prisma.hasRole.create({
    data: { userId: admin.id, role: "SYSTEM_ADMIN" },
  });
  return loginAndGetAccess(email, PASSWORD);
}

describe("notifications (#fcm)", () => {
  it("requires auth to register an FCM token", async () => {
    const res = await request
      .post("/me/fcm-tokens")
      .send({ token: "tok", deviceId: DEVICE_A, platform: "ANDROID" });
    expect(res.status).toBe(401);
  });

  it("registers a token, then updates the same device on re-register", async () => {
    const user = await createUser("fcm1@test.local", PASSWORD);
    const access = await loginAndGetAccess("fcm1@test.local", PASSWORD);

    const r1 = await request
      .post("/me/fcm-tokens")
      .set("Authorization", `Bearer ${access}`)
      .send({ token: "token-1", deviceId: DEVICE_A, platform: "ANDROID" });
    expect(r1.status).toBe(201);
    expect(r1.body).toMatchObject({ success: true, created: true });

    // Aynı cihazdan yeni token -> yeni satır değil, güncelleme.
    const r2 = await request
      .post("/me/fcm-tokens")
      .set("Authorization", `Bearer ${access}`)
      .send({ token: "token-2", deviceId: DEVICE_A, platform: "IOS" });
    expect(r2.status).toBe(201);
    expect(r2.body.created).toBe(false);

    const rows = await prisma.fcmToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      token: "token-2",
      platform: "IOS",
      isActive: true,
    });
  });

  it("rejects an invalid platform", async () => {
    await createUser("fcm2@test.local", PASSWORD);
    const access = await loginAndGetAccess("fcm2@test.local", PASSWORD);
    const res = await request
      .post("/me/fcm-tokens")
      .set("Authorization", `Bearer ${access}`)
      .send({ token: "tok", deviceId: DEVICE_A, platform: "NOKIA" });
    expect(res.status).toBe(400);
  });

  it("rejects a non-uuid deviceId", async () => {
    await createUser("fcm3@test.local", PASSWORD);
    const access = await loginAndGetAccess("fcm3@test.local", PASSWORD);
    const res = await request
      .post("/me/fcm-tokens")
      .set("Authorization", `Bearer ${access}`)
      .send({ token: "tok", deviceId: "not-a-uuid", platform: "WEB" });
    expect(res.status).toBe(400);
  });

  it("logout-all deactivates all of the user's FCM tokens", async () => {
    const user = await createUser("fcm4@test.local", PASSWORD);
    const access = await loginAndGetAccess("fcm4@test.local", PASSWORD);

    for (const [device, tok] of [
      [DEVICE_A, "t-a"],
      [DEVICE_B, "t-b"],
    ] as const) {
      const r = await request
        .post("/me/fcm-tokens")
        .set("Authorization", `Bearer ${access}`)
        .send({ token: tok, deviceId: device, platform: "ANDROID" });
      expect(r.status).toBe(201);
    }

    const rLogout = await request
      .post("/auth/logout-all")
      .set("Authorization", `Bearer ${access}`);
    expect(rLogout.status).toBe(200);

    const rows = await prisma.fcmToken.findMany({ where: { userId: user.id } });
    expect(rows).toHaveLength(2);
    expect(rows.every((t) => t.isActive === false)).toBe(true);
  });

  it("blocks non-admin users from sending notifications", async () => {
    await createUser("fcm5@test.local", PASSWORD);
    const access = await loginAndGetAccess("fcm5@test.local", PASSWORD);
    const res = await request
      .post("/notifications/send")
      .set("Authorization", `Bearer ${access}`)
      .send({ target: "all", payload: { title: "Hi" } });
    expect(res.status).toBe(403);
  });

  it("lets a SYSTEM_ADMIN queue a broadcast notification", async () => {
    const adminAccess = await createAdminAndLogin("fcm-admin1@test.local");
    const res = await request
      .post("/notifications/send")
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ target: "all", payload: { title: "Maintenance tonight" } });
    expect(res.status).toBe(202);
    expect(res.body).toMatchObject({ success: true, queued: true });
  });

  it("validates the send payload (user target needs userId)", async () => {
    const adminAccess = await createAdminAndLogin("fcm-admin2@test.local");
    const res = await request
      .post("/notifications/send")
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ target: "user", payload: { title: "Hey" } });
    expect(res.status).toBe(400);
  });
});
