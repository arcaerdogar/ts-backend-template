import { z } from "zod";

/**
 * POST /auth/oauth/google gövdesi (app-driven akış).
 * App, sistem tarayıcısındaki authorize'dan dönen code'u; PKCE code_verifier'ını
 * ve authorize'da kullandığı nonce'u getirir. state backend'e GELMEZ — CSRF
 * kontrolünü app kendi belleğindeki state ile lokal yapar (bkz. ADR 0002).
 */
export const oauthGoogleSchema = z.object({
  code: z.string().min(1),
  codeVerifier: z.string().min(1),
  nonce: z.string().min(1),
});
