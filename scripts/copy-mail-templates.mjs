import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const root = path.dirname(fileURLToPath(import.meta.url));
const srcDir = path.join(
  root,
  "..",
  "src",
  "services",
  "mail-service",
  "templates"
);
const destDir = path.join(
  root,
  "..",
  "dist",
  "services",
  "mail-service",
  "templates"
);

fs.mkdirSync(destDir, { recursive: true });
for (const name of fs.readdirSync(srcDir)) {
  if (name.endsWith(".hbs")) {
    fs.copyFileSync(path.join(srcDir, name), path.join(destDir, name));
  }
}
