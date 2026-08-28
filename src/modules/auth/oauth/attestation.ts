import type { NextFunction, Request, Response } from "express";
import { env } from "../../../config/env.js";
import { HttpError } from "../../common/errors.js";

/**
 * App attestation — eksik client_secret'ın "bu gerçekten senin app'in mi"
 * rolünü üstlenir (bkz. ADR 0002). Public native client'ta Google secret
 * vermediği için, isteğin gerçek + değiştirilmemiş app'ten geldiğini
 * platformun attestation servisi doğrular:
 *   - Android -> Play Integrity API
 *   - iOS     -> App Attest / DeviceCheck
 *
 * Bu dosya SÖZLEŞMEyi ve takma noktasını sağlar; gerçek doğrulama platform
 * kimlik bilgileri gerektirdiği için PROJEDE bağlanır. `setAppAttestationVerifier`
 * ile kendi doğrulayıcını kaydet. Bağlanmadan `OAUTH_ATTESTATION_ENABLED=true`
 * yaparsan, güvenli tarafta kalınır: istek reddedilir (fail-closed).
 */

export type AttestationContext = {
  /** İstemcinin bildirdiği platform (X-App-Platform header'ı). */
  platform: string | undefined;
  /** Ham attestation token'ı (X-App-Attestation header'ı). */
  token: string;
};

/** Geçerliyse resolve; geçersizse throw eden doğrulayıcı. */
export type AppAttestationVerifier = (ctx: AttestationContext) => Promise<void>;

// Varsayılan: bağlanmamış. enabled=true iken çağrılırsa fail-closed davranır.
let verifier: AppAttestationVerifier = async () => {
  throw HttpError.internal(
    "App attestation is enabled but no verifier is wired. " +
      "Call setAppAttestationVerifier() or disable OAUTH_ATTESTATION_ENABLED."
  );
};

/** Projeye özgü gerçek doğrulayıcıyı kaydeder (Play Integrity / App Attest). */
export function setAppAttestationVerifier(fn: AppAttestationVerifier): void {
  verifier = fn;
}

/**
 * Express middleware. OAUTH_ATTESTATION_ENABLED kapalıysa hiçbir şey yapmaz
 * (passthrough) — böylece attestation kullanmayan projeler etkilenmez. Açıkken
 * X-App-Attestation header'ını zorunlu kılar ve kayıtlı doğrulayıcıya sorar.
 */
export async function appAttestationGuard(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!env.oauth.attestation.enabled) return next();

  const token = req.headers["x-app-attestation"];
  if (typeof token !== "string" || token.length === 0) {
    throw HttpError.unauthorized(
      "Missing app attestation.",
      "OAUTH_ATTESTATION_REQUIRED"
    );
  }

  const platformHeader = req.headers["x-app-platform"];
  const platform =
    typeof platformHeader === "string" ? platformHeader : undefined;

  try {
    await verifier({ platform, token });
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw HttpError.unauthorized(
      "App attestation failed.",
      "OAUTH_ATTESTATION_INVALID"
    );
  }

  return next();
}
