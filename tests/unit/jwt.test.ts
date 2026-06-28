import { describe, it, expect } from "vitest";
import {
  signAccessToken,
  verifyAccessToken,
  sign2faToken,
  verify2faToken,
  signRootToken,
  verifyRootToken,
} from "../../src/modules/auth/jwt.js";

describe("jwt", () => {
  it("access token round-trips the userId in sub", () => {
    const token = signAccessToken("user-123");
    expect(verifyAccessToken(token).sub).toBe("user-123");
  });

  it("2fa token carries scope and extra claims", () => {
    const token = sign2faToken("user-1", "change-email", {
      newEmail: "new@test.local",
    });
    const payload = verify2faToken(token);
    expect(payload.sub).toBe("user-1");
    expect(payload.scope).toBe("change-email");
    expect(payload.newEmail).toBe("new@test.local");
  });

  it("root token has sub/scope = root", () => {
    const payload = verifyRootToken(signRootToken());
    expect(payload.sub).toBe("root");
    expect(payload.scope).toBe("root");
  });

  it("access and 2fa tokens are signed with different secrets", () => {
    // 2fa secret ile imzalanan token access secret ile doğrulanamamalı.
    const twofa = sign2faToken("u", "verify-email");
    expect(() => verifyAccessToken(twofa)).toThrow();
  });

  it("rejects a tampered token", () => {
    const token = signAccessToken("u") + "x";
    expect(() => verifyAccessToken(token)).toThrow();
  });
});
