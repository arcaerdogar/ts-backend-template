/**
 * OAuth uçtan uca doğrulama scripti (loopback varyantı).
 *
 * Bu script MOBİL APP'in rolünü oynar ama terminalde çalıştığı için App Link
 * yerine RFC 8252 §7.3 loopback redirect'ini kullanır. Backend endpoint'i
 * (`POST /auth/oauth/google`) production'daki ile BİREBİR aynıdır — yalnızca
 * redirect_uri tipi (loopback vs App Link) ve muhtemelen client tipi (Desktop/
 * Web = secret'lı vs mobil = secret'sız) farklıdır.
 *
 * Adımlar:
 *   1) state + code_verifier + nonce üret (app gibi)
 *   2) 127.0.0.1:<port>/callback'te küçük bir HTTP sunucu aç
 *   3) sistem tarayıcısını Google authorize URL'ine yönlendir
 *   4) redirect'i yakala, state'i LOKAL doğrula
 *   5) { code, codeVerifier, nonce } -> backend /auth/oauth/google
 *   6) backend'in login-şekilli yanıtını yazdır
 *
 * Çalıştırma:  npx tsx src/scripts/verify-oauth.ts
 *
 * Ön koşullar (bkz. script sonundaki hata mesajları):
 *   - Google'da OAuth client kaydı (Desktop app veya Web app) + loopback
 *     redirect URI'nin oraya EKLENMESİ.
 *   - .env: GOOGLE_CLIENT_ID, GOOGLE_REDIRECT_URI (= loopback), gerekiyorsa
 *     GOOGLE_CLIENT_SECRET (Desktop/Web client'ta vardır).
 *   - Backend ayakta (npm run dev) ve DB'de OAuthAccount tablosu mevcut
 *     (npx prisma db push) — aksi halde kullanıcı oluşturma patlar.
 */
import http from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { spawn } from "node:child_process";
import dotenv from "dotenv";

dotenv.config();

const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function b64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

/** Varsayılan tarayıcıda URL açar (platforma göre; başarısızsa yalnızca uyarır). */
function openBrowser(url: string): void {
  try {
    if (process.platform === "win32") {
      spawn("rundll32", ["url.dll,FileProtocolHandler", url], {
        detached: true,
        stdio: "ignore",
      }).unref();
    } else if (process.platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch {
    /* URL yine de aşağıda yazdırılıyor; elle açılabilir. */
  }
}

async function main() {
  const clientId = process.env.GOOGLE_CLIENT_ID;
  const redirectUri = process.env.GOOGLE_REDIRECT_URI;
  const backendUrl =
    process.env.OAUTH_TEST_BACKEND_URL ??
    `http://localhost:${process.env.PORT ?? 3000}`;

  if (!clientId) fail("GOOGLE_CLIENT_ID .env'de tanımlı değil.");
  if (!redirectUri) fail("GOOGLE_REDIRECT_URI .env'de tanımlı değil.");

  const redirect = new URL(redirectUri);
  const isLoopback =
    redirect.hostname === "127.0.0.1" || redirect.hostname === "localhost";
  if (!isLoopback) {
    fail(
      `GOOGLE_REDIRECT_URI loopback değil (${redirect.hostname}). Terminal ` +
        `testi için http://127.0.0.1:<port>/callback gibi bir loopback adresi ` +
        `kullan ve bunu Google konsolunda da kayıtlı redirect'e ekle. ` +
        `(App Link yalnızca gerçek cihazda çalışır.)`
    );
  }
  const port = Number(redirect.port || 80);

  // 1) App gibi akış sırlarını üret.
  const state = b64url(randomBytes(32));
  const codeVerifier = b64url(randomBytes(32));
  const nonce = b64url(randomBytes(32));
  const codeChallenge = b64url(createHash("sha256").update(codeVerifier).digest());

  console.log("• Akış sırları üretildi (cihazda kalır):");
  console.log(`    state        = ${state.slice(0, 12)}…`);
  console.log(`    code_verifier= ${codeVerifier.slice(0, 12)}…  (ağdan geçmez)`);
  console.log(`    nonce        = ${nonce.slice(0, 12)}…`);

  // 2) Authorize URL (app kurar).
  const authorizeUrl = new URL(GOOGLE_AUTHORIZE_URL);
  authorizeUrl.search = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  }).toString();

  // 3) Redirect'i yakalayacak loopback sunucu + akışın tamamlanmasını bekle.
  const result = await new Promise<{ code: string }>((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Zaman aşımı: 5 dakikada redirect gelmedi.")),
      5 * 60 * 1000
    );

    const server = http.createServer((req, res) => {
      if (!req.url || !req.url.startsWith(redirect.pathname)) {
        res.writeHead(404).end();
        return;
      }
      const q = new URL(req.url, `http://127.0.0.1:${port}`).searchParams;
      const err = q.get("error");
      const code = q.get("code");
      const returnedState = q.get("state");

      const done = (ok: boolean, msg: string) => {
        res.writeHead(ok ? 200 : 400, { "Content-Type": "text/html; charset=utf-8" });
        res.end(
          `<html><body style="font-family:sans-serif;padding:2rem">` +
            `<h3>${ok ? "✅ Doğrulama devam ediyor" : "❌ Hata"}</h3>` +
            `<p>${msg}</p><p>Bu sekmeyi kapatabilirsin.</p></body></html>`
        );
        clearTimeout(timer);
        server.close();
      };

      if (err) {
        done(false, `Google hata döndü: ${err}`);
        reject(new Error(`Google error: ${err}`));
        return;
      }
      // 4) state'i LOKAL doğrula (CSRF) — backend'e gitmeden.
      if (returnedState !== state) {
        done(false, "state eşleşmedi (CSRF kontrolü).");
        reject(new Error("state mismatch — CSRF kontrolü başarısız."));
        return;
      }
      if (!code) {
        done(false, "code yok.");
        reject(new Error("callback'te code yok."));
        return;
      }
      done(true, "code alındı, backend'e iletiliyor…");
      resolve({ code });
    });

    server.on("error", reject);
    server.listen(port, "127.0.0.1", () => {
      console.log(`\n• Loopback sunucu dinliyor: ${redirectUri}`);
      console.log("• Tarayıcı açılıyor (açılmazsa şu URL'i elle aç):\n");
      console.log(`  ${authorizeUrl.toString()}\n`);
      openBrowser(authorizeUrl.toString());
      console.log("• Google'da giriş yap ve izin ver…");
    });
  });

  // 4') state doğrulandı (yukarıda).
  console.log("• Redirect yakalandı, state lokal doğrulandı ✔");

  // 5) code'u backend'e ilet (app'in yaptığı tek istek).
  const endpoint = `${backendUrl.replace(/\/$/, "")}/auth/oauth/google`;
  console.log(`• POST ${endpoint}`);
  let res: Response;
  try {
    res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: result.code, codeVerifier, nonce }),
      // Backend yanıt vermezse sessizce asılı kalma.
      signal: AbortSignal.timeout(20000),
    });
  } catch (e) {
    const name = e instanceof Error ? e.name : "";
    if (name === "TimeoutError") {
      fail(
        "Backend 20 sn içinde yanıt vermedi (asılı kaldı). En olası sebep: " +
          "issueRefreshToken Redis'e bağlanamıyor (dev Redis kapalı mı?). " +
          "Backend terminalindeki logları kontrol et."
      );
    }
    fail(
      `Backend'e ulaşılamadı (${endpoint}). Ayakta mı? npm run dev çalışıyor mu? ` +
        `Ayrıntı: ${e instanceof Error ? e.message : String(e)}`
    );
  }

  const text = await res.text();
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = text;
  }

  if (!res.ok) {
    console.error(`\n❌ Backend ${res.status} döndü:`);
    console.error(JSON.stringify(parsed, null, 2));
    process.exit(1);
  }

  // 6) Login-şekilli yanıt.
  const body = parsed as {
    user?: { userId: string; email: string };
    access?: string;
    session?: { refreshToken: string; deviceId: string; expiresAt: string };
  };
  console.log("\n✅ BAŞARILI — backend login-şekilli oturum döndü:\n");
  console.log(`   user.userId  = ${body.user?.userId}`);
  console.log(`   user.email   = ${body.user?.email}`);
  console.log(`   access       = ${body.access?.slice(0, 24)}… (JWT)`);
  console.log(`   refreshToken = ${body.session?.refreshToken?.slice(0, 24)}…`);
  console.log(`   deviceId     = ${body.session?.deviceId}`);
  console.log(`   expiresAt    = ${body.session?.expiresAt}`);
  console.log("\nGoogle'ın access/refresh token'ları cihaza inmedi (yalnızca id_token okundu).\n");
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
