import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Handlebars from "handlebars";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const templateCache = new Map<string, Handlebars.TemplateDelegate>();

export function renderTemplate(name: string, data: Record<string, any>) {
  let template = templateCache.get(name);

  if (!template) {
    const filePath = path.join(__dirname, `${name}.hbs`);
    const fileContent = fs.readFileSync(filePath, "utf8");

    template = Handlebars.compile(fileContent);
    templateCache.set(name, template);
  }

  return template(data);
}
