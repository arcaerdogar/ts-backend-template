import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Test DB'sine şemayı bir kez push'lar.
    globalSetup: ["./tests/globalSetup.ts"],
    // Her test dosyasından önce: env yükle, SES mock'unu kur, Redis/DB temizle.
    setupFiles: ["./tests/setup.ts"],
    // Entegrasyon testleri tek bir DB'yi paylaşıp aralarında truncate ettiği
    // için paralel çalıştırmıyoruz (yarış koşullarını önler).
    fileParallelism: false,
    hookTimeout: 30_000,
    testTimeout: 30_000,
  },
});
