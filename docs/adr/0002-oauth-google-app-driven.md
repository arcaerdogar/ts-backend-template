# ADR 0002 — Google OAuth / OIDC Girişi (App-Driven, RFC 8252)

- **Durum:** Kabul edildi
- **Tarih:** 2026-08-05
- **İlgili:** ADR [0001](0001-session-storage-and-audit.md) (oturum/audit altyapısı bu akış tarafından aynen kullanılır), RFC 8252 (OAuth 2.0 for Native Apps), RFC 7636 (PKCE), OpenID Connect Core

---

## Bağlam

Template'e "Google ile giriş" ekleniyor. Uygulama **mobil**. Mevcut şifre-tabanlı auth (argon2 + refresh rotation + blocklist + `AuthEvent`) **değişmeyecek**; OAuth yalnızca kullanıcıyı doğruladıktan sonra mevcut `signAccessToken` + `issueRefreshToken`'a bağlanan **ikinci bir kimlik ispatı kanalı**dır.

Çekirdek kavramsal ayrım: **OAuth 2.0 yetkilendirme (authorization) protokolüdür; kimliği (authentication) OIDC katmanı verir.** "Google ile giriş" bir kimlik işidir → bize lazım olan `access_token` değil, imzalı **`id_token`**'dır.

Karara etki eden iki alternatif vardı:

- **Mimari A — web redirect:** authorize URL'ini backend kurar, callback'i backend alır, token'ı frontend'e `exchange_code` ile teslim eder. Cookie'siz bir global Redis-state, callback'i başlatan tarayıcıya **bağlanamadığı** için login-CSRF'e açıktır; düzeltmek cookie gerektirir.
- **Mimari B — app-driven (seçilen):** akışı app sürer, `code`'u backend'e verir, exchange'i backend yapar (BFF deseni).

---

## Karar

**Mimari B — app-driven, backend exchange.** Detaylar:

### 1. Akış (RFC 8252 native app)

1. App üretir: `state`, `code_verifier`, `nonce` (üçü de yalnızca cihaz belleğinde).
2. App **sistem tarayıcısını** açar (iOS `ASWebAuthenticationSession` / Android Custom Tabs — **embedded webview DEĞİL**) ve authorize URL'ini **kendisi kurar** (`code_challenge=S256(code_verifier)`, `scope=openid email profile`, `redirect_uri` = App Link).
3. Google, **App Link / Universal Link**'e (claimed https) redirect eder → OS bunu yalnızca domaini sahiplenen app'e teslim eder.
4. App **lokal** doğrular: dönen `state` == ürettiği `state` mi? Değilse iptal. (CSRF kontrolü app'te; `state` backend'e **gelmez**.)
5. App backend'e tek istek atar: `POST /auth/oauth/google { code, codeVerifier, nonce }` (+ opsiyonel attestation header'ı).
6. Backend: (opsiyonel attestation) → code'u Google token endpoint'inde exchange → `id_token`'ı **doğrular** → `sub` ile kullanıcıyı çöz → **kendi oturumunu** üret → **login endpoint'iyle birebir aynı** yanıtı döndür.

### 2. Güvenlik mekanizmaları ve kim doğrular

| Mekanizma | Kim üretir | Kim doğrular | Neyi korur |
|---|---|---|---|
| `state` | App | **App** (lokal, bellek) | CSRF — yanıt bu app'in isteğine mi ait |
| `code_verifier` (PKCE) | App | **Google** (token endpoint) | Çalınan `code`'un kullanılması (RFC 7636) |
| `nonce` | App | Backend (id_token claim'i) | id_token replay — OIDC hijyeni (bkz. not) |
| `id_token` imza/iss/aud/exp | Google imzalar | **Backend** (JWKS, `jwt.verify`) | Sahte/başkasına ait token (confused deputy = `aud`) |
| app attestation | Platform | **Backend** (opsiyonel) | İsteğin gerçek app'ten gelmesi (client_secret'ın yerine) |

### 3. `client_secret` yok — public client

RFC 8252 §8.5 native client'larda paylaşılan sır ile kimlik doğrulamayı **NOT RECOMMENDED** der; Google iOS/Android client tipine **client_secret vermez**. App Link redirect ile zaten public client tipindeyiz. Sonuç:

- Kodda `client_secret` **opsiyonel**dir; varsa exchange gövdesine eklenir (confidential varyant), yoksa eklenmez.
- Çalınan-code korumasını **PKCE** taşır — confidential client'ta `client_secret`'ın yaptığı işi public client'ta `code_verifier` yapar.
- `client_secret`'ın **"bu gerçekten senin app'in mi"** rolünü ise **app attestation** üstlenir (Play Integrity / App Attest). Bu, RFC 8252'de yer almayan ek sertleştirmedir; `oauth/attestation.ts` sözleşmeyi ve fail-closed middleware'i sağlar, **gerçek doğrulayıcı projede `setAppAttestationVerifier()` ile bağlanır**. Bağlanmadan `OAUTH_ATTESTATION_ENABLED=true` yapılırsa istek reddedilir (fail-closed).

> **⚠️ PRODUCTION ŞARTI.** Bu template attestation'ı **stub** olarak gönderir (varsayılan kapalı). Gerçek bir uygulamaya geçerken bu ADR'nin karşılanması için **zorunlu** üç adım: (1) platforma özgü gerçek doğrulayıcıyı yaz ve `setAppAttestationVerifier()` ile kaydet, (2) `OAUTH_ATTESTATION_ENABLED=true` yap, (3) redirect olarak **App Link / Universal Link** kullan (bare custom scheme değil). Bunlar yapılmadan `client_secret`'ın yokluğu gerçek bir zayıflık bırakır (klon-app riski); template'i "olduğu gibi" production'a alma.

### 4. Hesap eşleştirme

Eşleştirme birincil anahtarı **DAİMA `sub`** (`OAuthAccount(provider, providerAccountId)`), e-posta değil — e-posta değişebilir, `sub` değişmez. E-posta üzerinden **otomatik link YALNIZCA** `id_token.email_verified === true` **VE** sistemdeki kullanıcı `emailVerified === true` iken yapılır; aksi halde sessiz devralma yerine `409 OAUTH_EMAIL_EXISTS` döner. Yeni kullanıcı `User + Profile + OAuthAccount` tek transaction'da oluşur (profil zorunluluğu korunur); `passwordHash` null kalır.

### 5. Redis gerekmez, tek endpoint

`state`/`code_verifier`/`nonce` app'te yaşadığı için OAuth el sıkışması **stateless**tir — handshake için Redis kullanılmaz (refresh token altyapısının Redis kullanımı ayrıdır, değişmez). Web modelindeki `/start` + `/callback` + `/exchange` üçlüsü **tek** `POST /auth/oauth/google`'a iner. Google'ın `access_token`/`refresh_token`'ı cihaza inmez ve **DB'ye yazılmaz** — yalnızca `id_token` okunur.

> **nonce notu:** Backend `id_token`'ı doğrudan token endpoint'inden, PKCE-bağlı `code` ile aldığı için replay zaten `code`+PKCE bağıyla engellenir; `nonce`'un kriptografik katkısı bu modelde sınırlıdır (istemci hem code hem nonce'u sağladığından). Yine de OIDC hijyeni ve olası varyantlar için uçtan uca korunur.

---

## İşleyiş kontratı

### Endpoint

```
POST /auth/oauth/google
Headers (attestation açıksa):
  X-App-Attestation: <platform attestation token>
  X-App-Platform:   ios | android          (opsiyonel bilgi)
Body:
  { "code": "...", "codeVerifier": "...", "nonce": "..." }

200 OK  (login endpoint'iyle BİREBİR aynı şekil)
  {
    "user":    { "userId": "...", "email": "..." },
    "access":  "<jwt>",
    "session": { "refreshToken": "...", "expiresAt": "...", "deviceId": "..." }
  }
```

Yalnızca **Google aktifse** mount edilir (`GOOGLE_CLIENT_ID` + `GOOGLE_REDIRECT_URI` dolu). Aktif değilse rota hiç var olmaz (404) — yarım config ile sessiz hata yok.

### İstemci (app) sorumlulukları

- `state` + `code_verifier` + `nonce` üret (kriptografik rastgele); `code_challenge = base64url(sha256(code_verifier))`.
- Authorize'ı **sistem tarayıcısında** aç, **embedded webview kullanma**.
- `redirect_uri` = **App Link / Universal Link** (claimed https); bare custom scheme kullanma (Google app-impersonation nedeniyle desteklemiyor).
- Dönen `state`'i lokal doğrula; eşleşmezse backend'e gitme.
- `code` + `codeVerifier` + `nonce`'u backend'e ilet; attestation açıksa header'ı ekle.

### Backend sorumlulukları

- (opsiyonel) attestation doğrula → code exchange → `id_token`'ı **verify** (decode değil): imza (JWKS/`kid`) + `iss` + `aud`==clientId + `exp` + `nonce`.
- `sub` ile bul/oluştur/bağla → `signAccessToken` + `issueRefreshToken` → audit → login-şekilli yanıt.

### Hata kodları

| Kod | Anlam |
|---|---|
| `OAUTH_INVALID_TOKEN` | id_token doğrulama başarısız (imza/iss/aud/exp/nonce/sub/email) |
| `OAUTH_TOKEN_EXCHANGE_FAILED` | Google token endpoint reddetti / id_token yok |
| `OAUTH_EMAIL_EXISTS` | E-posta mevcut, güvenli otomatik link koşulu sağlanmadı (409) |
| `OAUTH_ATTESTATION_REQUIRED` | Attestation açık ama header yok |
| `OAUTH_ATTESTATION_INVALID` | Attestation doğrulaması başarısız |

### Audit (`AuthEvent`)

`OAUTH_REGISTER` (yeni) / `OAUTH_LOGIN` (mevcut) / `OAUTH_LINKED` (bağlandı); `meta.provider = "GOOGLE"`. Altyapı ADR 0001'deki `recordAuthEvent`.

---

## Resmi kaynaklarla uyum

| Karar | Kaynak |
|---|---|
| Authorization Code (Implicit değil) | RFC 8252 §6 / §8.2 |
| PKCE zorunlu | RFC 8252 §6 "**MUST** implement PKCE" |
| Sistem tarayıcısı, embedded webview yok | RFC 8252 §8.12 "**MUST NOT** use embedded user-agents" |
| Claimed https / App Links | RFC 8252 §7.2 (preferred); Google: custom scheme "no longer supported" |
| Public client, secret yok | RFC 8252 §8.5; Google "client_secret is not applicable to iOS/Android" |

**Sapma:** Saf RFC 8252'de exchange'i **app** yapar; biz **backend**'de yapıyoruz (BFF). Bu bir ihlal değil, ek güvenlik: Google token'ları cihazdan uzak kalır, `id_token` doğrulaması merkezîleşir. Tüm normatif RFC 8252 maddeleri karşılanır.

---

## Sonuçlar

**Olumlu**
- Login-CSRF yapısal olarak yok: akışı başlatan/bitiren tek app örneği, `state`'i kendi belleğinde doğrular (cookie/Redis gerekmez).
- Mevcut auth (rotation/blocklist/audit) hiç değişmedi — OAuth sadece `signAccessToken`+`issueRefreshToken`'a bağlanıyor.
- Tek endpoint, stateless handshake; Google token'ları cihaza/DB'ye inmiyor.
- Provider arayüzü (`OAuthProviderAdapter`) sayesinde GitHub/Apple ileride aynı sözleşmeye eklenebilir.

**Olumsuz / Takaslar**
- `client_secret` yok → uygulama kimliği için **app attestation** gerekir; bu projede bağlanmalıdır (aksi halde eksik client_secret bir zayıflık bırakır).
- Authorize URL'i app kurduğu için `scope`/parametreler app'te; sunucudan uzaktan değiştirilemez (istenirse config endpoint'i eklenebilir).
- `nonce`'un kripto katkısı bu modelde sınırlı (bkz. not).

**Riskler**
- **Bare custom scheme** kullanılırsa (App Links yerine) clone app riski gerçekleşir — App Links + attestation şarttır.
- Attestation `enabled` ama doğrulayıcı bağlı değilse istekler reddedilir (fail-closed — bilinçli).
