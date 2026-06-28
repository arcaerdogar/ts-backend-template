import { describe, it, expect } from "vitest";
import { request, createUser, loginAndGetAccess } from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";

function makePhotoFile(userId: string, key: string) {
  return prisma.file.create({
    data: {
      key,
      bucket: "test-bucket",
      name: "avatar.jpg",
      mimeType: "image/jpeg",
      size: 1234,
      checksum: "checksum-abc",
      purpose: "PROFILE_PHOTO",
      userId,
      isActive: true,
    },
  });
}

describe("profile (#2)", () => {
  it("register requires firstName and lastName", async () => {
    const res = await request
      .post("/auth/register")
      .send({ email: "np@test.local", password: PASSWORD });
    expect(res.status).toBe(400);
  });

  it("GET /me returns the profile created at register", async () => {
    await createUser("p1@test.local", PASSWORD, {
      firstName: "Grace",
      lastName: "Hopper",
    });
    const access = await loginAndGetAccess("p1@test.local", PASSWORD);
    const res = await request.get("/me").set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.profile).toMatchObject({
      firstName: "Grace",
      lastName: "Hopper",
      photoUrl: null,
    });
  });

  it("PATCH /me/profile updates fields", async () => {
    await createUser("p2@test.local", PASSWORD);
    const access = await loginAndGetAccess("p2@test.local", PASSWORD);
    const res = await request
      .patch("/me/profile")
      .set("Authorization", `Bearer ${access}`)
      .send({ firstName: "Edsger" });
    expect(res.status).toBe(200);
    expect(res.body.profile.firstName).toBe("Edsger");
  });

  it("PUT /me/profile/photo links a File and soft-deletes the previous one", async () => {
    const user = await createUser("p3@test.local", PASSWORD);
    const access = await loginAndGetAccess("p3@test.local", PASSWORD);

    const file1 = await makePhotoFile(user.id, "profile-photos/2026/06/f1-avatar.jpg");
    const r1 = await request
      .put("/me/profile/photo")
      .set("Authorization", `Bearer ${access}`)
      .send({ fileId: file1.id });
    expect(r1.status).toBe(200);
    expect(r1.body.profile.photoUrl).toContain("f1-avatar.jpg");

    const file2 = await makePhotoFile(user.id, "profile-photos/2026/06/f2-avatar.jpg");
    const r2 = await request
      .put("/me/profile/photo")
      .set("Authorization", `Bearer ${access}`)
      .send({ fileId: file2.id });
    expect(r2.status).toBe(200);
    expect(r2.body.profile.photoUrl).toContain("f2-avatar.jpg");

    const oldFile = await prisma.file.findUnique({ where: { id: file1.id } });
    expect(oldFile?.isActive).toBe(false);
  });

  it("rejects linking a file owned by another user", async () => {
    const owner = await createUser("p4@test.local", PASSWORD);
    await createUser("p5@test.local", PASSWORD);
    const access = await loginAndGetAccess("p5@test.local", PASSWORD);
    const file = await makePhotoFile(owner.id, "profile-photos/2026/06/owned.jpg");
    const res = await request
      .put("/me/profile/photo")
      .set("Authorization", `Bearer ${access}`)
      .send({ fileId: file.id });
    expect(res.status).toBe(403);
  });
});
