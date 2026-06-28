import { describe, it, expect } from "vitest";
import { request, createUser, loginAndGetAccess } from "../helpers/auth.js";
import { sign2faToken } from "../../src/modules/auth/jwt.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";
const delUrl = (token: string) => `/me?token=${encodeURIComponent(token)}`;

function makeFile(userId: string, key: string) {
  return prisma.file.create({
    data: {
      key,
      bucket: "test-bucket",
      name: "f",
      mimeType: "image/jpeg",
      size: 1,
      checksum: "c",
      purpose: "PROFILE_PHOTO",
      userId,
      isActive: true,
    },
  });
}

describe("delete account (#1)", () => {
  it("requires a 2FA token", async () => {
    await createUser("d0@test.local", PASSWORD);
    const access = await loginAndGetAccess("d0@test.local", PASSWORD);
    const res = await request
      .delete("/me")
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(401);
  });

  it("self-deletes with a valid 2FA token; user+profile gone, file soft-deleted, audit kept", async () => {
    const user = await createUser("d1@test.local", PASSWORD);
    const access = await loginAndGetAccess("d1@test.local", PASSWORD);
    const file = await makeFile(user.id, "profile-photos/d1.jpg");
    const token = sign2faToken(user.id, "delete-account");

    const res = await request
      .delete(delUrl(token))
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);

    expect(await prisma.user.findUnique({ where: { id: user.id } })).toBeNull();
    expect(
      await prisma.profile.findUnique({ where: { userId: user.id } })
    ).toBeNull();

    const f = await prisma.file.findUnique({ where: { id: file.id } });
    expect(f?.isActive).toBe(false);
    expect(f?.userId).toBeNull(); // hard-delete -> SetNull

    const evt = await prisma.authEvent.findMany({
      where: { userId: user.id, type: "ACCOUNT_DELETED" },
    });
    expect(evt.length).toBe(1);
  });

  it("blocks the stale access token immediately after self-delete", async () => {
    const user = await createUser("d2@test.local", PASSWORD);
    const access = await loginAndGetAccess("d2@test.local", PASSWORD);
    const token = sign2faToken(user.id, "delete-account");
    await request.delete(delUrl(token)).set("Authorization", `Bearer ${access}`);

    const me = await request.get("/me").set("Authorization", `Bearer ${access}`);
    expect(me.status).toBe(401);
  });

  it("lets an admin delete a user", async () => {
    const admin = await createUser("dadmin@test.local", PASSWORD);
    await prisma.hasRole.create({
      data: { userId: admin.id, role: "SYSTEM_ADMIN" },
    });
    const adminAccess = await loginAndGetAccess("dadmin@test.local", PASSWORD);
    const target = await createUser("dtarget@test.local", PASSWORD);

    const res = await request
      .delete(`/users/${target.id}`)
      .set("Authorization", `Bearer ${adminAccess}`);
    expect(res.status).toBe(200);
    expect(
      await prisma.user.findUnique({ where: { id: target.id } })
    ).toBeNull();
  });

  it("blocks a suspended user's existing access token immediately (blocklist)", async () => {
    const admin = await createUser("sadm@test.local", PASSWORD);
    await prisma.hasRole.create({
      data: { userId: admin.id, role: "SYSTEM_ADMIN" },
    });
    const adminAccess = await loginAndGetAccess("sadm@test.local", PASSWORD);
    const victim = await createUser("svictim@test.local", PASSWORD);
    const victimAccess = await loginAndGetAccess("svictim@test.local", PASSWORD);

    // works before suspend
    const before = await request
      .get("/me")
      .set("Authorization", `Bearer ${victimAccess}`);
    expect(before.status).toBe(200);

    await request
      .patch(`/users/${victim.id}/suspend`)
      .set("Authorization", `Bearer ${adminAccess}`)
      .send({ suspended: true });

    // existing access token rejected at once (no 15m window)
    const after = await request
      .get("/me")
      .set("Authorization", `Bearer ${victimAccess}`);
    expect(after.status).toBe(401);
  });
});
