import { describe, it, expect } from "vitest";
import { request, createUser } from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";

const login = (email: string, password = PASSWORD) =>
  request.post("/auth/login").send({ email, password });

describe("auth audit log (AuthEvent)", () => {
  it("records LOGIN on a successful login", async () => {
    const u = await createUser("e1@test.local", PASSWORD);
    await login("e1@test.local");
    const rows = await prisma.authEvent.findMany({
      where: { userId: u.id, type: "LOGIN" },
    });
    expect(rows.length).toBe(1);
  });

  it("records LOGIN_FAILED (with userId) for a wrong password", async () => {
    const u = await createUser("e2@test.local", PASSWORD);
    await login("e2@test.local", "nope");
    const rows = await prisma.authEvent.findMany({
      where: { type: "LOGIN_FAILED", email: "e2@test.local" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.userId).toBe(u.id);
  });

  it("records LOGIN_FAILED with null userId for an unknown user", async () => {
    await login("ghost@test.local", "nope");
    const rows = await prisma.authEvent.findMany({
      where: { type: "LOGIN_FAILED", email: "ghost@test.local" },
    });
    expect(rows.length).toBe(1);
    expect(rows[0]?.userId).toBeNull();
  });

  it("records ACCOUNT_LOCKED after the lock threshold is hit", async () => {
    await createUser("e3@test.local", PASSWORD);
    for (let i = 0; i < 5; i++) await login("e3@test.local", "nope");
    const rows = await prisma.authEvent.findMany({
      where: { type: "ACCOUNT_LOCKED", email: "e3@test.local" },
    });
    expect(rows.length).toBe(1);
  });

  it("records ACCOUNT_SUSPENDED when an admin suspends a user", async () => {
    const admin = await createUser("eadmin@test.local", PASSWORD);
    await prisma.hasRole.create({
      data: { userId: admin.id, role: "SYSTEM_ADMIN" },
    });
    const adminLogin = await login("eadmin@test.local");
    const adminAccess = adminLogin.body.access;

    const target = await createUser("etarget@test.local", PASSWORD);
    await request
      .patch(`/users/${target.id}/suspend`)
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ suspended: true });

    const rows = await prisma.authEvent.findMany({
      where: { userId: target.id, type: "ACCOUNT_SUSPENDED" },
    });
    expect(rows.length).toBe(1);
  });
});
