# ADR 0001 — Session Depolama (Redis) ve Auth Denetim Kaydı

- **Durum:** Kabul edildi
- **Tarih:** 2026-06-28
- **İlgili issue'lar:** #19 (cleanup job — bu kararla büyük ölçüde konusuz kalır), #21 (structured logging — denetim kaydıyla birlikte tasarlanır), #8 (hesap suspend/lock — olayları bu kayda yazılır)

---

## Bağlam

Bugün oturum durumu Postgres'te iki tabloda tutuluyor:

- **`RefreshToken`** — `jti`, `tokenHash` (HMAC-SHA256), `deviceId`, `userAgent`, `ip`, `revoked`, `expiresAt`. Rotation, reuse kontrolü, device binding ve aktif oturum listeleme buradan yürür.
- **`ExpiredTwoFactorToken`** — kullanılmış 2FA token'larının tek-kullanımlık denylist'i (`tokenHash` + `expiresAt`).

Sorunlar ve gereksinimler:

1. **Temizlik yok (#19):** Süresi dolmuş / revoke edilmiş kayıtlar hiç silinmiyor; tablolar büyüdükçe hot `findUnique` sorguları yavaşlar.
2. **Mobil dayanıklılık:** Uygulama mobil. Sunucunun (API süreci) geçici çökmesinde aktif oturumlar **kaybedilmemeli**.
3. **Geçmiş/denetim ihtiyacı:** Bir kullanıcının giriş geçmişi ve **hatalı giriş / kilit / suspend** gibi güvenlik olaylarının geçmişi görülebilmeli.
4. Redis projede zaten **zorunlu bağımlılık** (rate limiter + BullMQ).

Bu veriler uçucu, TTL'e bağlı ve sık erişilen veriler — Redis doğal bir aday. Ancak Redis TTL ile geçmişi siler; geçmiş ayrı, kalıcı bir kayıt ister.

---

## Karar

Uçucu canlı durum **Redis'e**, kalıcı geçmiş **Postgres'e** alınır (hibrit).

### 1. 2FA kullanılmış-token denylist → Redis

`ExpiredTwoFactorToken` tablosu kaldırılır. Tek-kullanımlık kontrol atomik tek komutla yapılır:

```
SET 2fa:used:<tokenHash> 1 NX EX <token-ttl-saniye>
```

- `NX` → daha önce set edilmişse `null` döner = **token zaten kullanılmış** (mevcut "findUnique sonra create" yarışını da kapatır).
- `EX` → token'ın `exp`'i kadar yaşar, otomatik silinir → cleanup gereksiz.

Kayıp riski düşük: Redis bu anahtarı kaybetse bile en kötü ihtimalle 2FA token'ı kendi kısa ömrü (≈10 dk) içinde tekrar kullanılabilir.

### 2. Refresh token / oturumlar → Redis (tek doğruluk kaynağı)

`RefreshToken` tablosu kaldırılır. Anahtar şeması:

| Anahtar | Tip | İçerik | TTL |
|---|---|---|---|
| `sess:<jti>` | Hash | `{userId, tokenHash, deviceId, ua, ip, createdAt, expiresAt}` | refresh ömrü |
| `user:<id>:sessions` | Sorted Set | üye=`jti`, skor=`expiresAt` | — (on-read budanır) |
| `user:<id>:device:<deviceId>` | String | o cihazın güncel `jti`'si | refresh ömrü |
| `revoked:<jti>` | String | `1` tombstone (reuse-detection) | token'ın kalan ömrü |

`jti` = rastgele UUID; `secret` = 32 rastgele byte; ham token = `jti.secret`; saklanan = `tokenHash = HMAC(ham)`. `jti`'yi bilen ama `secret`'i bilmeyen oturumu kullanamaz (mevcut güvenlik özelliği korunur).

**Yaşam döngüsü:**

- **Login / issue:** Cihaz başına tek aktif oturum (varsa eski cihaz oturumu devralınıp silinir), ardından `sess` + sorted set + device pointer yazılır. Çok-anahtarlı olduğu için tek atomik blokta (Lua/MULTI).
- **Refresh / rotate:** Tek **Lua script** (atomik). Sırasıyla: `revoked:<jti>` var mı → **REUSE → cihaz/kullanıcı ailesini düşür**; `sess` var mı; deviceId eşleşmesi; tokenHash doğrulaması; sonra rotate (eskiyi sil + tombstone yaz, yeniyi oluştur). Lua atomikliği "tam-bir-kez döndür" garantisini sağlar; eşzamanlı iki refresh'te ikincisi reddedilir.
- **Logout:** `sess` sil + sorted set'ten çıkar + tombstone.
- **Logout-all / suspend / parola değişimi (`revokeAll`):** sorted set'teki tüm jti'leri sil + tombstone + device pointer'ları temizle. **Parola değişiminde eager çağrılır** (bugünkü lazy `passwordChangedAt` kontrolü yerine → anında global logout).
- **Aktif oturum listeleme:** `ZREMRANGEBYSCORE ... -inf <now>` ile bayat üyeleri buda, sonra `ZRANGE` + her jti için `HGETALL`.

### 3. Dayanıklılık (lokal Redis)

```conf
appendonly yes              # AOF: her yazma sürekli diske loglanır
appendfsync everysec        # hard crash'te en fazla ~1 sn kayıp
maxmemory-policy noeviction # canlı oturumlar ASLA evict edilmez
```

- API (Node) süreci çökse oturumlar etkilenmez (dış süreçte yaşar).
- Redis süreci çökse AOF logundan replay ile geri yüklenir (≤1 sn kayıp).
- Felaket düzeyi (disk ölümü) dayanıklılık bu ADR'nin kapsamı dışı; ileride replika eklenebilir.

### 4. Geçmiş / denetim → Postgres `AuthEvent` (append-only)

Geçmiş, kalıcı ve değişmez bir olay kaydında tutulur. Hem oturum yaşam döngüsünü hem kimlik doğrulama denemelerini kapsar.

```prisma
enum AuthEventType {
  // Oturum yaşam döngüsü
  LOGIN
  LOGOUT
  LOGOUT_ALL
  ADMIN_REVOKE
  PASSWORD_REVOKE
  REUSE_DETECTED

  // Kimlik doğrulama denemeleri / güvenlik
  LOGIN_FAILED
  LOGIN_BLOCKED_LOCKED
  LOGIN_BLOCKED_SUSPENDED
  ACCOUNT_LOCKED
  ACCOUNT_SUSPENDED
  ACCOUNT_UNSUSPENDED

  // 2FA
  TWO_FA_ISSUED
  TWO_FA_VERIFIED
  TWO_FA_FAILED
}

model AuthEvent {
  id        String        @id @default(uuid())
  userId    String?       // null: bilinmeyen kullanıcıya yapılan deneme
  email     String?       // denenen e-posta (kullanıcı yoksa bile)
  type      AuthEventType
  jti       String?
  deviceId  String?
  ip        String?
  userAgent String?
  meta      Json?
  createdAt DateTime      @default(now())

  @@index([userId, createdAt])
  @@index([type, createdAt])
  @@index([email, createdAt])
}
```

Kararlar:

- **`userId` nullable + `email`:** Hatalı giriş var olmayan kullanıcıya da yapılabilir (enumeration / credential stuffing). Bunları kaçırmamak için userId boşken bile denenen e-posta yazılır.
- **Hard FK yok** (`userId` düz string). Audit kaydı kullanıcı yaşam döngüsünden bağımsız ve değişmez kalır; kullanıcı silinince (ileride #1) geçmiş cascade ile uçmaz.
- **`TOKEN_REFRESH` loglanmaz** — 15 dk'da bir tetiklendiği için gürültülü; iz değeri düşük.
- **Asla** şifre/ham token yazılmaz; token yalnızca `jti`/hash referansıyla.

### 5. Tek çıkış noktası ve #21 ile ilişki

Tüm olaylar tek bir yardımcıdan geçer:

```
recordAuthEvent(event):
   1. AuthEvent satırını yaz      → sorgulanabilir, kullanıcı-bazlı GEÇMİŞ (otorite)
   2. logger.info({ ...event })   → operasyonel gözlemlenebilirlik (#21)
```

| | `AuthEvent` (Postgres) | Structured logs (#21) |
|---|---|---|
| Amaç | Ürün/forensics: kullanıcı giriş geçmişi | Ops: alerting, request tracing, debug |
| Sorgu | SQL (`userId`/`email` + `createdAt`) | Log aggregator |
| Saklama | Uzun (retention/partition) | Kısa-orta |
| Otorite | Sorgulanabilir geçmişin tek kaynağı | Türetilmiş/operasyonel |

İkisi tekrar değil, tamamlayıcıdır. #21 geldiğinde yalnızca (2) adımına request/correlation ID enjekte edilir. **Yazım best-effort'tur:** denetim yazımı auth akışını asla bloklamaz/bozmaz (try/catch ile yutulur veya BullMQ'ya atılır).

---

## Sonuçlar

**Olumlu**
- #19 erir: `sess:*`, `revoked:*`, `2fa:used:*` TTL ile otomatik temizlenir; sorted set on-read budanır → cron gerekmez.
- Rotation/revoke/lookup hot-path'i Postgres yükünden çıkar.
- Reuse-detection bugünkünden güçlü (tombstone → cihaz ailesini düşürme).
- Parola değişiminde anında global logout.
- Sorgulanabilir, kalıcı giriş + güvenlik geçmişi (`AuthEvent`).

**Olumsuz / Takaslar**
- Çok-anahtarlı işlemler için **Lua/MULTI** atomikliği gerekir (SQL transaction yerine).
- Aktif oturum listesinde **on-read budama** gerekir (sorted set bayat üyeler).
- İki ayrı store → cross-store atomiklik yok; parola/suspend'de **eager revoke** ile yönetilir.
- Postgres'e yeni append-only tablo (retention/partition ile yönetilir; hot-path değil).

**Riskler**
- Yanlış `maxmemory-policy` (noeviction değilse) → canlı oturumların sessiz tahliyesi. **Şart: noeviction + yeterli bellek.**
- Redis kalıcılık (AOF) yapılandırılmazsa restart'ta oturum kaybı.

---

## Uygulama planı (fazlı)

1. **2FA denylist → Redis** (küçük, izole; `ExpiredTwoFactorToken` kaldırılır). Mevcut `twoFactorAuthGuard`'daki "scope kontrolünden önce kullanıldı işaretleme" hatası da bu adımda düzeltilir.
2. **Refresh/sessions → Redis** + `recordAuthEvent` çağrı noktaları + `AuthEvent` tablosu (`RefreshToken` kaldırılır). DB yazımı best-effort.
3. **#21 structured logging** → `recordAuthEvent`'in log ayağını pino + request/correlation ID ile zenginleştir.

---

## Operasyonel notlar

- Redis bağlantısı tek client üzerinden paylaşılmalı (rate limiter + BullMQ + session) — bağlantı limiti.
- Bu ADR lokal Redis varsayar; yönetilen sağlayıcıya (Upstash vb.) özgü maliyet/limit konuları ileride ayrıca değerlendirilecek.
- `KEYS` kullanılmaz; gerektiğinde `SCAN`. `DEL` desen kabul etmez — device pointer'ları oturum üzerinden tek tek silinir.
