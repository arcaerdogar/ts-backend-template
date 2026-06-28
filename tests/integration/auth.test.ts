import { describe, it, expect } from "vitest";
import { request, createUser } from "../helpers/auth.js";

const PASSWORD = "super-secret-pw";

describe("POST /auth/register", () => {
  it("creates a user and returns access + refresh session", async () => {
    const res = await request
      .post("/auth/register")
      .send({ email: "new@test.local", password: PASSWORD });

    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe("new@test.local");
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
