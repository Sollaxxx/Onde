#!/usr/bin/env node
// Extrait du CHANGELOG les notes d'une version (par défaut celle de package.json).
// Usage : node scripts/notes.mjs [0.3.2]  → texte sur la sortie standard
import { readFileSync } from "node:fs";

const version = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
const text = readFileSync("CHANGELOG.md", "utf8");
const start = text.indexOf(`\n## ${version}\n`);
if (start < 0) {
  console.error(`Pas de notes pour la version ${version} dans CHANGELOG.md`);
  process.exit(1);
}
const rest = text.slice(start + `\n## ${version}\n`.length);
const end = rest.search(/\n## \d/);
process.stdout.write((end < 0 ? rest : rest.slice(0, end)).trim() + "\n");
