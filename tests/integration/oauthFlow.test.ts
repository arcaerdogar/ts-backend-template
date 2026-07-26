import { describe, it, expect } from "vitest";
import {
  consumeExchange,
  consumeFlow,
  saveExchange,
  saveFlow,
} from "../../src/modules/auth/oauth/oauth.flow.js";

describe("oauth.flow single-use (Redis GETDEL)", () => {
  it("consumes a flow state exactly once (replay -> null)", async () => {
    const ok = await saveFlow("state-1", {
      codeVerifier: "verifier-1",
      nonce: "nonce-1",
    });
    expect(ok).toBe(true);

    const first = await consumeFlow("state-1");
    expect(first).toEqual({ codeVerifier: "verifier-1", nonce: "nonce-1" });

    // İkinci okuma başarısız olmalı -> replay engellenir (idempotent DEĞİL).
    const second = await consumeFlow("state-1");
    expect(second).toBeNull();
  });

  it("consumes an exchange code exactly once (replay -> null)", async () => {
    const data = {
      user: { userId: "u1", email: "e@test.local" },
      access: "access-token",
      session: {
        refreshToken: "refresh-token",
        expiresAt: new Date().toISOString(),
        deviceId: "device-1",
      },
    };
    const ok = await saveExchange("code-1", data);
    expect(ok).toBe(true);

    const first = await consumeExchange("code-1");
    expect(first).toEqual(data);

    const second = await consumeExchange("code-1");
    expect(second).toBeNull();
  });

  it("returns null when consuming an unknown state", async () => {
    expect(await consumeFlow("does-not-exist")).toBeNull();
  });
});
