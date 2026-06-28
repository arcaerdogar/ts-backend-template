import { describe, it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { request, createUser } from "../helpers/auth.js";

const PASSWORD = "super-secret-pw";

describe("POST /auth/register", () => {
  it("creates a user and returns access + refresh session", async () => {
    const res = await request.post("/auth/register").send({
      email: "new@test.local",
      password: PASSWORD,
      firstName: "Ada",
      lastName: "Lovelace",
    });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("new@test.local");
    expect(res.body.profile).toEqual({ firstName: "Ada", lastName: "Lovelace" });
    expect(res.body.access).toBeTruthy();
    expect(res.body.session.refreshToken).toBeTruthy();
    expect(res.body.session.deviceId).toBeTruthy();
  });
});

describe("POST /auth/login", () => {
  it("logs in with correct credentials", async () => {
    await createUser("a@test.local", PASSWORD);
    const res = await request
      .post("/auth/login")
      .send({ email: "a@test.local", password: PASSWORD });

    expect(res.status).toBe(200);
    expect(res.body.access).toBeTruthy();
  });

  it("rejects wrong password with INVALID_CREDENTIALS", async () => {
    await createUser("b@test.local", PASSWORD);
    const res = await request
      .post("/auth/login")
      .send({ email: "b@test.local", password: "wrong" });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });
});

// Issue #8: hesap koruması
describe("account protection (#8)", () => {
  it("blocks login for suspended accounts", async () => {
    await createUser("susp@test.local", PASSWORD, { suspended: true });
    const res = await request
      .post("/auth/login")
      .send({ email: "susp@test.local", password: PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error).toBe("ACCOUNT_SUSPENDED");
  });

  it("locks the account after 5 failed attempts", async () => {
    await createUser("lock@test.local", PASSWORD);

    // 5 hatalı deneme -> hepsi INVALID_CREDENTIALS
    for (let i = 0; i < 5; i++) {
      const res = await request
        .post("/auth/login")
        .send({ email: "lock@test.local", password: "wrong" });
      expect(res.status).toBe(401);
      expect(res.body.error).toBe("INVALID_CREDENTIALS");
    }

    // 6. deneme doğru şifreyle bile olsa kilitli olmalı
    const locked = await request
      .post("/auth/login")
      .send({ email: "lock@test.local", password: PASSWORD });
    expect(locked.status).toBe(403);
    expect(locked.body.error).toBe("ACCOUNT_LOCKED");
  });

  it("resets the failed counter on a successful login", async () => {
    await createUser("reset@test.local", PASSWORD);

    // 4 hatalı (kilit eşiğinin altında)
    for (let i = 0; i < 4; i++) {
      await request
        .post("/auth/login")
        .send({ email: "reset@test.local", password: "wrong" });
    }

    // Doğru giriş sayacı sıfırlamalı
    const ok = await request
      .post("/auth/login")
      .send({ email: "reset@test.local", password: PASSWORD });
    expect(ok.status).toBe(200);

    // Tekrar 4 hatalı kilitlememeli (sayaç sıfırlandığı için)
    for (let i = 0; i < 4; i++) {
      const res = await request
        .post("/auth/login")
        .send({ email: "reset@test.local", password: "wrong" });
      expect(res.body.error).toBe("INVALID_CREDENTIALS");
    }
  });
});

describe("register validation & edge cases", () => {
  const base = { password: PASSWORD, firstName: "A", lastName: "B" };

  it("rejects a duplicate email with 409", async () => {
    await createUser("dup@test.local", PASSWORD);
    const res = await request
      .post("/auth/register")
      .send({ ...base, email: "dup@test.local" });
    expect(res.status).toBe(409);
    expect(res.body.error).toBe("EMAIL_IN_USE");
  });

  it("treats email case-insensitively (duplicate)", async () => {
    await createUser("case@test.local", PASSWORD);
    const res = await request
      .post("/auth/register")
      .send({ ...base, email: "CASE@Test.Local" });
    expect(res.status).toBe(409);
  });

  it("rejects an invalid email format", async () => {
    const res = await request
      .post("/auth/register")
      .send({ ...base, email: "not-an-email" });
    expect(res.status).toBe(400);
  });

  it("rejects a password shorter than 8 chars", async () => {
    const res = await request
      .post("/auth/register")
      .send({ ...base, email: "short@test.local", password: "short" });
    expect(res.status).toBe(400);
  });
});

describe("login edge cases", () => {
  it("returns 401 for a non-existent email", async () => {
    const res = await request
      .post("/auth/login")
      .send({ email: "ghost@test.local", password: PASSWORD });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe("INVALID_CREDENTIALS");
  });

  it("logs in case-insensitively", async () => {
    await createUser("ci@test.local", PASSWORD);
    const res = await request
      .post("/auth/login")
      .send({ email: "CI@TEST.LOCAL", password: PASSWORD });
    expect(res.status).toBe(200);
  });

  it("enforces a single active session per device on login", async () => {
    await createUser("dev1@test.local", PASSWORD);
    const deviceId = randomUUID();

    const first = await request
      .post("/auth/login")
      .send({ email: "dev1@test.local", password: PASSWORD, deviceId });
    const firstToken = first.body.session.refreshToken;

    // Aynı deviceId ile tekrar login -> önceki oturum iptal edilmeli
    await request
      .post("/auth/login")
      .send({ email: "dev1@test.local", password: PASSWORD, deviceId });

    const res = await request
      .post("/auth/refresh")
      .send({ refreshToken: firstToken, deviceId });
    expect(res.status).toBe(401);
  });
});
