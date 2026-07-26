import { describe, it, expect } from "vitest";
import { prisma } from "../../src/config/db.js";
import { createUser } from "../helpers/auth.js";
import { findOrCreateUserByOAuth } from "../../src/modules/auth/oauth/oauth.service.js";
import type { OAuthIdentity } from "../../src/modules/auth/oauth/providers/provider.interface.js";

function identity(overrides: Partial<OAuthIdentity> = {}): OAuthIdentity {
  return {
    provider: "GOOGLE",
    providerAccountId: "google-sub-1",
    email: "oauth@test.local",
    emailVerified: true,
    firstName: "OA",
    lastName: "Uth",
    ...overrides,
  };
}

describe("findOrCreateUserByOAuth", () => {
  it("creates User + Profile + OAuthAccount for a new sub (profile mandatory)", async () => {
    const { user, outcome } = await findOrCreateUserByOAuth(identity());
    expect(outcome).toBe("REGISTERED");

    const dbUser = await prisma.user.findUnique({
      where: { id: user.id },
      include: { profile: true, oauthAccounts: true },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser!.passwordHash).toBeNull(); // sosyal-giriş -> şifre yok
    expect(dbUser!.profile).not.toBeNull();
    expect(dbUser!.profile!.firstName).toBe("OA");
    expect(dbUser!.oauthAccounts).toHaveLength(1);
    expect(dbUser!.oauthAccounts[0]!.provider).toBe("GOOGLE");
    expect(dbUser!.oauthAccounts[0]!.providerAccountId).toBe("google-sub-1");
  });

  it("returns the same user (LOGGED_IN) when the sub already exists", async () => {
    const first = await findOrCreateUserByOAuth(identity());
    const second = await findOrCreateUserByOAuth(identity());

    expect(second.outcome).toBe("LOGGED_IN");
    expect(second.user.id).toBe(first.user.id);
    expect(await prisma.user.count()).toBe(1);
    expect(await prisma.oAuthAccount.count()).toBe(1);
  });

  it("auto-links when BOTH sides have emailVerified=true", async () => {
    const existing = await createUser("link@test.local", "pw-123456", {
      emailVerified: true,
    });

    const { user, outcome } = await findOrCreateUserByOAuth(
      identity({ email: "link@test.local", emailVerified: true })
    );

    expect(outcome).toBe("LINKED");
    expect(user.id).toBe(existing.id);
    const accounts = await prisma.oAuthAccount.findMany({
      where: { userId: existing.id },
    });
    expect(accounts).toHaveLength(1);
  });

  it("does NOT auto-link when the identity email is unverified (separate behavior)", async () => {
    await createUser("noverify@test.local", "pw-123456", {
      emailVerified: true,
    });

    await expect(
      findOrCreateUserByOAuth(
        identity({ email: "noverify@test.local", emailVerified: false })
      )
    ).rejects.toMatchObject({ code: "OAUTH_EMAIL_EXISTS" });

    // Mevcut kullanıcıya link YAPILMADIĞINI doğrula.
    expect(await prisma.oAuthAccount.count()).toBe(0);
  });

  it("does NOT auto-link when the system user email is unverified", async () => {
    await createUser("sysunverified@test.local", "pw-123456", {
      emailVerified: false,
    });

    await expect(
      findOrCreateUserByOAuth(
        identity({ email: "sysunverified@test.local", emailVerified: true })
      )
    ).rejects.toMatchObject({ code: "OAUTH_EMAIL_EXISTS" });

    expect(await prisma.oAuthAccount.count()).toBe(0);
  });
});
