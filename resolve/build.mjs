// Construit l'interface du panneau DaVinci Resolve (resolve/plugin/renderer.js) à partir de resolve/src.
// Usage : npm run resolve   (lancé aussi par npm run build)
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");

await build({
  entryPoints: [`${here}src/host-resolve.ts`],
  outfile: `${here}plugin/renderer.js`,
  bundle: true,
  format: "iife",
  charset: "utf8",
  target: "chrome110",
  logLevel: "info",
});
cpSync(`${here}../premiere/src/styles.css`, `${here}plugin/styles.css`);
mkdirSync(`${here}plugin/img`, { recursive: true });
cpSync(`${here}../src-tauri/resources/drag-icon.png`, `${here}plugin/img/drag.png`);
