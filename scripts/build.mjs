import { cpSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const output = resolve(root, "dist");
const files = ["index.html", "app.js", "styles.css"];

mkdirSync(output, { recursive: true });

for (const file of files) {
  cpSync(resolve(root, file), resolve(output, file));
}

console.log(`Built static site in ${output}`);
