// Vérifie que chaque texte de l'interface a sa traduction anglaise dans src/i18n.ts.
// Usage : node scripts/verifier-traductions.mjs   (code de sortie 1 s'il en manque)
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const files = ["src", "premiere/src", "resolve/src"].flatMap((d) => {
  try { return readdirSync(join(root, d)).filter((f) => f.endsWith(".ts")).map((f) => join(root, d, f)); } catch { return []; }
});

/** Lit une chaîne JavaScript entre guillemets doubles à partir de `i` (sur le guillemet ouvrant). */
function readString(src, i) {
  let out = "";
  for (let j = i + 1; j < src.length; j++) {
    const c = src[j];
    if (c === "\\") { const n = src[++j]; out += n === "n" ? "\n" : n; continue; }
    if (c === '"') return [out, j + 1];
    out += c;
  }
  return [null, src.length];
}

const used = new Map();
for (const f of files) {
  const src = readFileSync(f, "utf8");
  // t("…"), tr("…") et les deux formes de tn(n, "…", "…")
  for (const m of src.matchAll(/\b(?:t|tr|tn)\(/g)) {
    let i = m.index + m[0].length;
    const isTn = m[0].startsWith("tn");
    if (isTn) { i = src.indexOf(",", i) + 1; }
    for (let k = 0; k < (isTn ? 2 : 1); k++) {
      while (/\s/.test(src[i])) i++;
      if (src[i] !== '"') break;
      const [s, end] = readString(src, i);
      if (s !== null) used.set(s, f.slice(root.length));
      i = end;
      while (/[\s,]/.test(src[i])) i++;
    }
  }
}

const dict = readFileSync(join(root, "src/i18n.ts"), "utf8");
const known = new Set();
const body = dict.slice(dict.indexOf("const EN"), dict.indexOf("// ---------- fin des traductions"));
for (let i = 0; i < body.length; i++) {
  if (body[i] === '"') {
    const [s, end] = readString(body, i);
    // une clé est suivie de « : »
    if (/^\s*:/.test(body.slice(end))) known.add(s);
    i = end - 1;
  }
}

// Textes passés à t() par une variable (étapes de l'accueil…) : à déclarer ici
for (const s of ["Bienvenue", "Dossier des sons", "Logiciels de montage", "C'est prêt"]) used.set(s, "src/bienvenue.ts");

const missing = [...used].filter(([s]) => !known.has(s));
const unused = [...known].filter((s) => !used.has(s));
for (const [s, f] of missing) console.log(`MANQUANT  ${f} : ${JSON.stringify(s)}`);
if (process.argv.includes("--inutiles")) for (const s of unused) console.log(`INUTILE   ${JSON.stringify(s)}`);
console.log(`${used.size} textes, ${missing.length} sans traduction.`);
process.exit(missing.length ? 1 : 0);
