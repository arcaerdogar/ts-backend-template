import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
  S3Client,
  HeadObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { request, createUser, loginAndGetAccess } from "../helpers/auth.js";
import { prisma } from "../../src/config/db.js";

const PASSWORD = "super-secret-pw";
const s3Mock = mockClient(S3Client);

beforeEach(() => {
  s3Mock.reset();
});

function makeFile(
  userId: string,
  key: string,
  opts: { isPublic?: boolean; isActive?: boolean } = {}
) {
  return prisma.file.create({
    data: {
      key,
      bucket: "test-bucket",
      name: "f",
      mimeType: "image/jpeg",
      size: 1,
      checksum: "c",
      purpose: "DOCUMENT",
      userId,
      isPublic: opts.isPublic ?? false,
      isActive: opts.isActive ?? true,
    },
  });
}

describe("POST /files/init", () => {
  it("returns a presigned url + temp key for a valid request", async () => {
    await createUser("fi@test.local", PASSWORD);
    const access = await loginAndGetAccess("fi@test.local", PASSWORD);
    const res = await request
      .post("/files/init")
      .set("Authorization", `Bearer ${access}`)
      .send({
        fileName: "My Photo.JPG",
        mimeType: "image/jpeg",
        size: 1024,
        purpose: "PROFILE_PHOTO",
        checksum: "0123456789abcdef",
      });
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
    expect(res.body.key).toMatch(/^temp\/profile-photos\//);
    expect(res.body.key).toContain("my-photo.jpg");
  });

  it("rejects an invalid mime type (no slash)", async () => {
    await createUser("fi2@test.local", PASSWORD);
    const access = await loginAndGetAccess("fi2@test.local", PASSWORD);
    const res = await request
      .post("/files/init")
      .set("Authorization", `Bearer ${access}`)
      .send({
        fileName: "x.bin",
        mimeType: "notamime",
        size: 10,
        purpose: "OTHER",
        checksum: "0123456789",
      });
    expect(res.status).toBe(400);
  });

  it("requires authentication", async () => {
    const res = await request.post("/files/init").send({
      fileName: "x.jpg",
      mimeType: "image/jpeg",
      size: 10,
      purpose: "OTHER",
      checksum: "0123456789",
    });
    expect(res.status).toBe(401);
  });
});

describe("POST /files/confirm", () => {
  it("confirms an upload, moves temp->final, and stores a File", async () => {
    const user = await createUser("fc@test.local", PASSWORD);
    const access = await loginAndGetAccess("fc@test.local", PASSWORD);

    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 2048,
      ContentType: "image/jpeg",
      ETag: '"etag-123"',
    });
    s3Mock.on(CopyObjectCommand).resolves({});
    s3Mock.on(DeleteObjectCommand).resolves({});

    const key = "temp/documents/2026/06/abc-report.pdf";
    const res = await request
      .post("/files/confirm")
      .set("Authorization", `Bearer ${access}`)
      .send({ key });

    expect(res.status).toBe(200);
    expect(res.body.file.key).toBe("documents/2026/06/abc-report.pdf");
    expect(res.body.file.userId).toBe(user.id);
    const inDb = await prisma.file.findUnique({
      where: { key: "documents/2026/06/abc-report.pdf" },
    });
    expect(inDb).not.toBeNull();
  });

  it("rejects a checksum mismatch and deletes the temp object", async () => {
    await createUser("fc2@test.local", PASSWORD);
    const access = await loginAndGetAccess("fc2@test.local", PASSWORD);

    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1,
      ContentType: "image/jpeg",
      ETag: '"real-etag"',
    });
    s3Mock.on(DeleteObjectCommand).resolves({});

    const res = await request
      .post("/files/confirm")
      .set("Authorization", `Bearer ${access}`)
      .send({ key: "temp/documents/2026/06/x.pdf", checksum: "wrong-etag" });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe("INTEGRITY_CHECK_FAILED");
  });

  it("rejects a key that is not under temp/", async () => {
    await createUser("fc3@test.local", PASSWORD);
    const access = await loginAndGetAccess("fc3@test.local", PASSWORD);
    s3Mock.on(HeadObjectCommand).resolves({
      ContentLength: 1,
      ContentType: "image/jpeg",
      ETag: '"e"',
    });
    const res = await request
      .post("/files/confirm")
      .set("Authorization", `Bearer ${access}`)
      .send({ key: "documents/already-final.pdf" });
    expect(res.status).toBe(400);
  });
});

describe("GET /files/download", () => {
  it("returns a signed url to the owner of a private file", async () => {
    const user = await createUser("fd@test.local", PASSWORD);
    const access = await loginAndGetAccess("fd@test.local", PASSWORD);
    await makeFile(user.id, "documents/2026/own.pdf");

    const res = await request
      .get("/files/download")
      .query({ key: "documents/2026/own.pdf" })
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    expect(res.body.url).toBeTruthy();
  });

  it("forbids another user from a private file", async () => {
    const owner = await createUser("fd2@test.local", PASSWORD);
    await createUser("fd3@test.local", PASSWORD);
    const otherAccess = await loginAndGetAccess("fd3@test.local", PASSWORD);
    await makeFile(owner.id, "documents/2026/secret.pdf");

    const res = await request
      .get("/files/download")
      .query({ key: "documents/2026/secret.pdf" })
      .set("Authorization", `Bearer ${otherAccess}`);
    expect(res.status).toBe(403);
  });

  it("allows another user to download a public file", async () => {
    const owner = await createUser("fd4@test.local", PASSWORD);
    await createUser("fd5@test.local", PASSWORD);
    const otherAccess = await loginAndGetAccess("fd5@test.local", PASSWORD);
    await makeFile(owner.id, "documents/2026/public.pdf", { isPublic: true });

    const res = await request
      .get("/files/download")
      .query({ key: "documents/2026/public.pdf" })
      .set("Authorization", `Bearer ${otherAccess}`);
    expect(res.status).toBe(200);
  });

  it("returns 404 for an unknown key", async () => {
    await createUser("fd6@test.local", PASSWORD);
    const access = await loginAndGetAccess("fd6@test.local", PASSWORD);
    const res = await request
      .get("/files/download")
      .query({ key: "documents/2026/nope.pdf" })
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(404);
  });
});

describe("DELETE /files/*key", () => {
  it("soft-deletes the owner's file", async () => {
    const user = await createUser("fdel@test.local", PASSWORD);
    const access = await loginAndGetAccess("fdel@test.local", PASSWORD);
    const key = "documents/2026/del.pdf";
    await makeFile(user.id, key);

    const res = await request
      .delete(`/files/${key}`)
      .set("Authorization", `Bearer ${access}`);
    expect(res.status).toBe(200);
    const inDb = await prisma.file.findUnique({ where: { key } });
    expect(inDb?.isActive).toBe(false);
  });

  it("forbids deleting another user's file", async () => {
    const owner = await createUser("fdel2@test.local", PASSWORD);
    await createUser("fdel3@test.local", PASSWORD);
    const otherAccess = await loginAndGetAccess("fdel3@test.local", PASSWORD);
    const key = "documents/2026/notyours.pdf";
    await makeFile(owner.id, key);

    const res = await request
      .delete(`/files/${key}`)
      .set("Authorization", `Bearer ${otherAccess}`);
    expect(res.status).toBe(403);
  });
});
