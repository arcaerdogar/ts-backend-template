import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function renderTemplate(name: string, data: Record<string, any>) {
  const filePath = path.join(__dirname, `${name}.hbs`);
  const fileContent = fs.readFileSync(filePath, "utf8");

  const template = Handlebars.compile(fileContent);
  return template(data);
}
