import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { generateKeyPairSync, createPublicKey } from "node:crypto";
import jwt from "jsonwebtoken";
import { verifyGoogleIdToken } from "../../src/modules/auth/oauth/providers/google.provider.js";
import { _clearJwksCache } from "../../src/modules/auth/oauth/jwks.js";

// .env.test'teki GOOGLE_CLIENT_ID ile eşleşmeli (aud doğrulaması bunu bekler).
const AUD = "test-google-client-id";
const ISS = "https://accounts.google.com";
const KID = "test-kid-1";
const NONCE = "nonce-abc";

// Testin kendi RSA çiftini üretir; jwks mock'u bu public key'i döndürür.
const { privateKey, publicKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

// İmzası geçersiz token üretmek için ikinci (yanlış) anahtar.
const wrong = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  publicKeyEncoding: { type: "spki", format: "pem" },
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
});

function jwksBody() {
  const jwk = createPublicKey(publicKey).export({ format: "jwk" });
  return { keys: [{ ...jwk, kid: KID, alg: "RS256", use: "sig" }] };
}

function basePayload(overrides: Record<string, unknown> = {}) {
  return {
    sub: "google-sub-123",
    email: "verify@test.local",
    email_verified: true,
    given_name: "Ver",
    family_name: "Ify",
    nonce: NONCE,
    ...overrides,
  };
}

function signWith(
  key: string,
  payload: Record<string, unknown>,
  opts: jwt.SignOptions = {}
) {
  return jwt.sign(payload, key, {
    algorithm: "RS256",
    keyid: KID,
    issuer: ISS,
    audience: AUD,
    expiresIn: "5m",
    ...opts,
  });
}

beforeEach(() => {
  _clearJwksCache();
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify(jwksBody()), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "cache-control": "max-age=3600",
      },
    })
  );
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("verifyGoogleIdToken", () => {
  it("accepts a valid id_token and normalizes the identity", async () => {
    const token = signWith(privateKey, basePayload());
    const identity = await verifyGoogleIdToken(token, NONCE);

    expect(identity).toMatchObject({
      provider: "GOOGLE",
      providerAccountId: "google-sub-123",
      email: "verify@test.local",
      emailVerified: true,
      firstName: "Ver",
      lastName: "Ify",
    });
  });

  it("rejects a token with an invalid signature", async () => {
    // Doğru kid ama YANLIŞ anahtarla imzalı -> imza doğrulaması patlar.
    const token = signWith(wrong.privateKey, basePayload());
    await expect(verifyGoogleIdToken(token, NONCE)).rejects.toMatchObject({
      code: "OAUTH_INVALID_TOKEN",
    });
  });

  it("rejects a wrong issuer", async () => {
    const token = signWith(privateKey, basePayload(), {
      issuer: "https://evil.example.com",
    });
    await expect(verifyGoogleIdToken(token, NONCE)).rejects.toMatchObject({
      code: "OAUTH_INVALID_TOKEN",
    });
  });

  it("rejects a wrong audience", async () => {
    const token = signWith(privateKey, basePayload(), {
      audience: "some-other-client-id",
    });
    await expect(verifyGoogleIdToken(token, NONCE)).rejects.toMatchObject({
      code: "OAUTH_INVALID_TOKEN",
    });
  });

  it("rejects an expired token", async () => {
    const token = signWith(privateKey, basePayload(), { expiresIn: -60 });
    await expect(verifyGoogleIdToken(token, NONCE)).rejects.toMatchObject({
      code: "OAUTH_INVALID_TOKEN",
    });
  });

  it("rejects a nonce mismatch", async () => {
    const token = signWith(privateKey, basePayload({ nonce: "other-nonce" }));
    await expect(verifyGoogleIdToken(token, NONCE)).rejects.toMatchObject({
      code: "OAUTH_INVALID_TOKEN",
    });
  });

  it("accepts the bare 'accounts.google.com' issuer variant", async () => {
    const token = signWith(privateKey, basePayload(), {
      issuer: "accounts.google.com",
    });
    const identity = await verifyGoogleIdToken(token, NONCE);
    expect(identity.providerAccountId).toBe("google-sub-123");
  });
});
