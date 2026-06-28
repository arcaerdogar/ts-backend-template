import dotenv from "dotenv";
import { execSync } from "node:child_process";

// Vitest worker'larından ayrı bir süreçte, tüm testlerden önce bir kez çalışır.
export default async function setup() {
  dotenv.config({ path: ".env.test", override: true });

  // Migration geçmişine ihtiyaç duymadan şemayı doğrudan test DB'sine uygula.
  // (Ephemeral test DB'si için migrate deploy yerine db push idealdir.)
  execSync("npx prisma db push --skip-generate --accept-data-loss", {
    stdio: "inherit",
    env: process.env,
  });
}
