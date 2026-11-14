// Construit les deux versions du panneau Premiere : CEP (Premiere 2019+) et UXP (Premiere 25.6+).
// Usage : npm run premiere
import { build } from "esbuild";
import { cpSync, mkdirSync } from "node:fs";

const here = new URL(".", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const common = { bundle: true, format: "iife", charset: "utf8", logLevel: "info" };

await build({ ...common, entryPoints: [`${here}src/host-cep.ts`], outfile: `${here}cep/main.js`, target: "chrome88", external: ["fs", "os", "path", "https"] });
await build({ ...common, entryPoints: [`${here}src/host-uxp.ts`], outfile: `${here}uxp/main.js`, target: "es2019", external: ["premierepro", "uxp", "fs", "os"] });

for (const dir of ["cep", "uxp"]) {
  cpSync(`${here}src/styles.css`, `${here}${dir}/styles.css`);
  mkdirSync(`${here}${dir}/icons`, { recursive: true });
  cpSync(`${here}icons`, `${here}${dir}/icons`, { recursive: true });
}
