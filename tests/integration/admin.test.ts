import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import {
  request,
  createUser,
  loginAndGetAccess,
  getRootToken,
} from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";

async function makeAdmin(email: string) {
  const user = await createUser(email, PASSWORD);
  await prisma.hasRole.create({
    data: { userId: user.id, role: "SYSTEM_ADMIN" },
  });
  const access = await loginAndGetAccess(email, PASSWORD);
  return { user, access };
}

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

describe("root /manage-system-admin guards & validation", () => {
  it("rejects without a root token", async () => {
    const u = await createUser("ms1@test.local", PASSWORD);
    const res = await request
      .post("/root/manage-system-admin")
      .send({ userId: u.id, assign: true });
    expect(res.status).toBe(401);
  });

  it("rejects a normal access token (not root)", async () => {
    const u = await createUser("ms2@test.local", PASSWORD);
    const access = await loginAndGetAccess("ms2@test.local", PASSWORD);
    const res = await request
      .post("/root/manage-system-admin")
      .set("Authorization", `Bearer ${access}`)
      .send({ userId: u.id, assign: true });
    expect(res.status).toBe(401);
  });

  it("rejects an invalid userId (validation)", async () => {
    const rootToken = await getRootToken();
    const res = await request
      .post("/root/manage-system-admin")
      .set("Authorization", `Bearer ${rootToken}`)
      .send({ userId: "not-a-uuid", assign: true });
    expect(res.status).toBe(400);
  });

  it("returns 404 for a non-existent user", async () => {
    const rootToken = await getRootToken();
    const res = await request
      .post("/root/manage-system-admin")
      .set("Authorization", `Bearer ${rootToken}`)
      .send({ userId: randomUUID(), assign: true });
    expect(res.status).toBe(404);
  });

  it("unassigning SYSTEM_ADMIN removes /users access", async () => {
    const { user, access } = await makeAdmin("ms3@test.local");
    const rootToken = await getRootToken();

    // önce erişebiliyor
    expect(
      (await request.get("/users").set("Authorization", `Bearer ${access}`))
        .status
    ).toBe(200);

    await request
      .post("/root/manage-system-admin")
      .set("Authorization", `Bearer ${rootToken}`)
      .send({ userId: user.id, assign: false });

    expect(
      (await request.get("/users").set("Authorization", `Bearer ${access}`))
        .status
    ).toBe(403);
  });
});

describe("admin user routes authorization", () => {
  it("forbids a non-admin from user detail / suspend / delete", async () => {
    const target = await createUser("t@test.local", PASSWORD);
    await createUser("plain@test.local", PASSWORD);
    const access = await loginAndGetAccess("plain@test.local", PASSWORD);
    const auth = ["Authorization", `Bearer ${access}`] as const;

    expect(
      (await request.get(`/users/${target.id}`).set(...auth)).status
    ).toBe(403);
    expect(
      (
        await request
          .patch(`/users/${target.id}/suspend`)
          .set(...auth)
          .send({ suspended: true })
      ).status
    ).toBe(403);
    expect(
      (await request.delete(`/users/${target.id}`).set(...auth)).status
    ).toBe(403);
  });
});

describe("GET /users/:id and listing", () => {
  it("returns user detail with profile for an admin", async () => {
    const { access } = await makeAdmin("ga@test.local");
    const target = await createUser("gtarget@test.local", PASSWORD, {
      firstName: "Linus",
      lastName: "Torvalds",
    });

    const res = await request
      .get(`/users/${target.id}`)
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe("gtarget@test.local");
    expect(res.body.profile).toMatchObject({
      firstName: "Linus",
      lastName: "Torvalds",
    });
  });

  it("returns 404 when suspending a non-existent user", async () => {
    const { access } = await makeAdmin("ga2@test.local");
    const res = await request
      .patch(`/users/${randomUUID()}/suspend`)
      .set("Authorization", `Bearer ${access}`)
      .send({ suspended: true });
    expect(res.status).toBe(404);
  });

  it("supports email search via ?q", async () => {
    const { access } = await makeAdmin("ga3@test.local");
    await createUser("needle@test.local", PASSWORD);
    await createUser("haystack@test.local", PASSWORD);

    const res = await request
      .get("/users")
      .query({ q: "needle" })
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.items[0].email).toBe("needle@test.local");
  });

  it("paginates with page/limit", async () => {
    const { access } = await makeAdmin("ga4@test.local");
    const res = await request
      .get("/users")
      .query({ page: 1, limit: 1 })
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.items.length).toBe(1);
    expect(res.body.limit).toBe(1);
  });
});

describe("root cookie auth on admin routes", () => {
  it("accepts the HttpOnly root cookie", async () => {
    const rootLogin = await request.post("/root/login").send({
      email: process.env.ADMIN_EMAIL,
      password: process.env.ADMIN_PASSWORD,
    });
    const cookie = (rootLogin.headers["set-cookie"] as unknown as string[]).join(
      "; "
    );

    const res = await request.get("/users").set("Cookie", cookie);
    expect(res.status).toBe(200);
  });
});
