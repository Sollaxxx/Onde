#!/usr/bin/env node
// Change le numéro de version d'Onde partout où il apparaît.
// Usage : node scripts/version.mjs 0.2.0
import { readFileSync, writeFileSync } from "node:fs";

const version = process.argv[2];
if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) {
  console.error("Usage : node scripts/version.mjs 0.2.0");
  process.exit(1);
}

const json = (path, edit) => {
  const data = JSON.parse(readFileSync(path, "utf8"));
  edit(data);
  writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
};

json("package.json", (d) => { d.version = version; });
json("src-tauri/tauri.conf.json", (d) => { d.version = version; });

const cargo = readFileSync("src-tauri/Cargo.toml", "utf8").replace(/^version = "[^"]*"/m, `version = "${version}"`);
writeFileSync("src-tauri/Cargo.toml", cargo);

console.log(`Version ${version} : package.json, tauri.conf.json et Cargo.toml mis à jour.`);
