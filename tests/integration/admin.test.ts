import { describe, it, expect } from "vitest";
import {
  request,
  createUser,
  loginAndGetAccess,
  getRootToken,
} from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";

describe("POST /root/login", () => {
  it("issues a root token for valid env credentials", async () => {
    const res = await request.post("/root/login").send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    expect(res.status).toBe(200);
    expect(res.body.access).toBeTruthy();
    // HttpOnly cookie de set edilmeli
    const cookies = res.headers["set-cookie"] as unknown as string[];
    expect(cookies.some((c) => c.startsWith("root_access="))).toBe(true);
  });

  it("rejects invalid root credentials", async () => {
    const res = await request
      .post("/root/login")
      .send({ email: process.env.ADMIN_EMAIL, password: "nope" });
    expect(res.status).toBe(401);
  });
});

describe("SYSTEM_ADMIN role management", () => {
  it("root can assign SYSTEM_ADMIN, granting access to /users", async () => {
    const user = await createUser("admin@test.local", PASSWORD);
    const rootToken = await getRootToken();

    // Atamadan önce: normal kullanıcı /users'a erişemez (403)
    const userAccess = await loginAndGetAccess("admin@test.local", PASSWORD);
    const before = await request
      .get("/users")
      .set("Authorization", `Bearer ${userAccess}`);
    expect(before.status).toBe(403);

    // Root, SYSTEM_ADMIN ata
    const assign = await request
      .post("/root/manage-system-admin")
      .set("Authorization", `Bearer ${rootToken}`)
      .send({ userId: user.id, assign: true });
    expect(assign.status).toBe(200);

    // Artık erişebilmeli
    const after = await request
      .get("/users")
      .set("Authorization", `Bearer ${userAccess}`);
    expect(after.status).toBe(200);
    expect(after.body.total).toBeGreaterThanOrEqual(1);
  });

  it("requires a token for /users", async () => {
    const res = await request.get("/users");
    expect(res.status).toBe(401);
  });
});

describe("PATCH /users/:id/suspend", () => {
  it("system admin suspends a user; suspended user can no longer log in or refresh", async () => {
    const admin = await createUser("sa@test.local", PASSWORD);
    await prisma.hasRole.create({
      data: { userId: admin.id, role: "SYSTEM_ADMIN" },
    });
    const adminAccess = await loginAndGetAccess("sa@test.local", PASSWORD);

    const target = await createUser("victim@test.local", PASSWORD);
    // Hedef login olup aktif bir refresh oturumu oluştursun
    const targetLogin = await request
      .post("/auth/login")
      .send({ email: "victim@test.local", password: PASSWORD });
    const refreshToken = targetLogin.body.session.refreshToken;
    const deviceId = targetLogin.body.session.deviceId;

    // Suspend et
    const suspend = await request
      .patch(`/users/${target.id}/suspend`)
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ suspended: true });
    expect(suspend.status).toBe(200);
    expect(suspend.body.isSuspended).toBe(true);

    // Login engellenmeli
    const login = await request
      .post("/auth/login")
      .send({ email: "victim@test.local", password: PASSWORD });
    expect(login.status).toBe(403);
    expect(login.body.error).toBe("ACCOUNT_SUSPENDED");

    // Mevcut refresh token revoke edilmiş olmalı
    const refresh = await request
      .post("/auth/refresh")
      .send({ refreshToken, deviceId });
    expect(refresh.status).toBe(401);
  });

  it("can un-suspend a user", async () => {
    const admin = await createUser("sa2@test.local", PASSWORD);
    await prisma.hasRole.create({
      data: { userId: admin.id, role: "SYSTEM_ADMIN" },
    });
    const adminAccess = await loginAndGetAccess("sa2@test.local", PASSWORD);

    const target = await createUser("victim2@test.local", PASSWORD, {
      suspended: true,
    });

    const res = await request
      .patch(`/users/${target.id}/suspend`)
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ suspended: false });
    expect(res.status).toBe(200);
    expect(res.body.isSuspended).toBe(false);

    const login = await request
      .post("/auth/login")
      .send({ email: "victim2@test.local", password: PASSWORD });
    expect(login.status).toBe(200);
  });
});
