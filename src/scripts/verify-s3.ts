/**
 * S3 uçtan uca doğrulama scripti.
 *
 * Gerçek AWS S3'e karşı, uygulamanın kullandığı `storageService` (S3Service)
 * üzerinden tüm upload yaşam döngüsünü sırayla dener ve sonunda temizler:
 *
 *   1) init   -> presigned PUT URL al (temp/ altına)
 *   2) PUT    -> küçük bir test dosyasını doğrudan S3'e yükle (presigned URL)
 *   3) head   -> checkExists ile nesnenin varlığını + metadata'sını doğrula
 *   4) move   -> temp/ -> final/ taşı (copy + delete)
 *   5) sign   -> presigned GET URL al ve indir, byte'ları karşılaştır
 *   6) public -> CDN/public URL'i yazdır (bilgi amaçlı)
 *   7) cleanup-> oluşturulan test nesnesini sil
 *
 * Çalıştırma:  npx tsx src/scripts/verify-s3.ts
 *
 * Ön koşullar:
 *   - .env: AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, S3_BUCKET_NAME
 *   - IAM kullanıcısının bucket üzerinde PutObject/GetObject/HeadObject/
 *     CopyObject/DeleteObject izinleri.
 *
 * NOT: Bu script GERÇEK S3'e yazar (birkaç byte'lık geçici bir nesne) ve
 * sonunda siler. Testleri değil, canlı entegrasyonu doğrular.
 */
import { randomBytes, createHash } from "node:crypto";
import dotenv from "dotenv";

dotenv.config();

function fail(msg: string): never {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
}

async function main() {
  // env.ts zorunlu AWS değişkenleri eksikse burada net bir hata fırlatır.
  for (const name of [
    "AWS_REGION",
    "AWS_ACCESS_KEY_ID",
    "AWS_SECRET_ACCESS_KEY",
    "S3_BUCKET_NAME",
  ]) {
    if (!process.env[name]) fail(`${name} .env'de tanımlı değil.`);
  }

  // Dinamik import: env doğrulaması yukarıda geçtikten SONRA yükle (S3Service
  // import anında env.ts'i tetikler).
  const { storageService } = await import(
    "../services/storage/s3.service.js"
  );

  const stamp = Date.now();
  const contentType = "text/plain";
  const body = Buffer.from(`s3-verify ${new Date(stamp).toISOString()}\n`);
  const checksum = createHash("sha256").update(body).digest("base64");
  const fileKey = `verify-${stamp}-${randomBytes(4).toString("hex")}.txt`;

  // 1) init — temp/ altına presigned PUT URL.
  const { url: uploadUrl, key: tempKey } =
    await storageService.getPresignedUploadUrl(
      "temp",
      fileKey,
      contentType,
      body.length,
      checksum,
    );
  console.log(`• [1/7] init      -> presigned PUT alındı  (key: ${tempKey})`);

  // 2) PUT — dosyayı doğrudan S3'e yükle. Content-Type, imzalanan değerle
  //    eşleşmeli (getSignedUrl ContentType ile imzalandı).
  const put = await fetch(uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body,
    signal: AbortSignal.timeout(20000),
  });
  if (!put.ok) {
    fail(
      `PUT başarısız (${put.status}). Presigned URL / IAM PutObject izni / ` +
        `Content-Type uyumunu kontrol et. Yanıt: ${await put.text()}`,
    );
  }
  console.log(`• [2/7] PUT       -> yüklendi (${body.length} byte)`);

  // 3) head — nesne var mı + metadata.
  const meta = await storageService.checkExists(tempKey);
  if (meta.size !== body.length) {
    fail(`checkExists boyutu uyuşmadı: beklenen ${body.length}, gelen ${meta.size}`);
  }
  console.log(
    `• [3/7] head      -> checkExists OK (size=${meta.size}, mime=${meta.mimeType})`,
  );

  // 4) move — temp/ -> final/.
  const finalKey = tempKey.replace(/^temp\//, "final/");
  await storageService.move(tempKey, finalKey);
  console.log(`• [4/7] move      -> temp/ -> final/  (key: ${finalKey})`);

  // 5) sign + download — presigned GET ile indir, byte karşılaştır.
  const downloadUrl = await storageService.getPresignedDownloadUrl(finalKey);
  const got = await fetch(downloadUrl, { signal: AbortSignal.timeout(20000) });
  if (!got.ok) fail(`presigned GET başarısız (${got.status}).`);
  const downloaded = Buffer.from(await got.arrayBuffer());
  if (!downloaded.equals(body)) {
    fail("İndirilen içerik yüklenenle birebir aynı değil.");
  }
  console.log(`• [5/7] download  -> presigned GET OK, içerik birebir eşleşti`);

  // 6) public url — bilgi amaçlı (private bucket'ta erişilebilir olmayabilir).
  console.log(`• [6/7] publicUrl -> ${storageService.getPublicUrl(finalKey)}`);

  // 7) cleanup — test nesnesini sil.
  await storageService.delete(finalKey);
  console.log(`• [7/7] cleanup   -> test nesnesi silindi`);

  console.log("\n✅ BAŞARILI — S3 entegrasyonu uçtan uca çalışıyor.\n");
  process.exit(0);
}

main().catch((e) => fail(e instanceof Error ? e.message : String(e)));
