#!/usr/bin/env node
// Extrait du CHANGELOG les notes d'une version (par défaut celle de package.json).
// Usage : node scripts/notes.mjs [0.3.2]  → texte sur la sortie standard
import { readFileSync } from "node:fs";

const version = process.argv[2] ?? JSON.parse(readFileSync("package.json", "utf8")).version;
// Sur Windows, git peut convertir les fins de ligne en \r\n : on les ramène à \n
const text = readFileSync("CHANGELOG.md", "utf8").replace(/\r\n?/g, "\n");
const start = text.indexOf(`\n## ${version}\n`);
if (start < 0) {
  console.error(`Pas de notes pour la version ${version} dans CHANGELOG.md`);
  process.exit(1);
}
const rest = text.slice(start + `\n## ${version}\n`.length);
const end = rest.search(/\n## \d/);
process.stdout.write((end < 0 ? rest : rest.slice(0, end)).trim() + "\n");
