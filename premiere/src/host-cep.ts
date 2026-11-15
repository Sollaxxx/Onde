// Panneau Onde, version CEP : Premiere Pro 2019 et plus (2022, 2023, 2024, 2025…).
// Le panneau tourne dans un Chromium avec Node.js (fichiers, réseau sans restriction),
// et parle à Premiere via un script ExtendScript (host.jsx).
import { startPanel, type Host } from "./ui";
import type { Sound } from "../../src/types";

declare const require: (m: string) => any;
declare const process: any;
declare const Buffer: any;
declare global { interface Window { __adobe_cep__?: any } }

const fs = require("fs");
const os = require("os");
const path = require("path");
const https = require("https");

const isWin = process.platform === "win32";

/** Exécute une fonction ExtendScript dans Premiere et renvoie sa réponse texte. */
function evalScript(code: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const cep = window.__adobe_cep__;
    if (!cep) { reject(new Error("panneau ouvert hors de Premiere")); return; }
    cep.evalScript(code, (res: string) => resolve(res));
  });
}

function get(url: string, redirects = 3): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Onde-Premiere" } }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(res.headers.location, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(`réponse ${res.statusCode}`)); return; }
      resolve(res);
    }).on("error", reject);
  });
}

const ERRORS: Record<string, string> = {
  noproject: "ouvrez d'abord un projet",
  nosequence: "ouvrez une séquence dans la timeline",
  import: "le son n'a pas pu être importé",
  notrack: "aucune piste audio libre à la tête de lecture",
};

function timecode(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Suit le thème de Premiere (couleur de fond des panneaux). */
function applyHostTheme(): void {
  try {
    const env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
    const c = env.appSkinInfo.panelBackgroundColor.color;
    const rgb = `rgb(${Math.round(c.red)}, ${Math.round(c.green)}, ${Math.round(c.blue)})`;
    document.documentElement.style.setProperty("--bg", rgb);
    const light = (c.red + c.green + c.blue) / 3 > 128;
    if (light) {
      document.documentElement.style.setProperty("--ink", "#1b1b1b");
      document.documentElement.style.setProperty("--muted", "#5e5e5e");
      document.documentElement.style.setProperty("--line", "#c8c8c8");
    }
  } catch { /* thème par défaut */ }
}

const host: Host = {
  canDrag: true,
  sep: path.sep,

  async libraryDir() {
    const home = os.homedir();
    const cfg = isWin
      ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "app.onde.desktop")
      : path.join(home, "Library", "Application Support", "app.onde.desktop");
    try {
      const hint = fs.readFileSync(path.join(cfg, "bibliotheque.txt"), "utf8").trim();
      if (hint) return hint;
    } catch { /* application Onde absente : dossier par défaut */ }
    for (const docs of [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents")]) {
      if (fs.existsSync(path.join(docs, "Onde"))) return path.join(docs, "Onde");
    }
    return path.join(home, "Documents", "Onde");
  },

  async getJson(url) {
    const res = await get(url);
    const chunks: any[] = [];
    for await (const c of res) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  },

  async download(url, dest) {
    if (fs.existsSync(dest)) return;
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    const part = `${dest}.part`;
    const res = await get(url);
    await new Promise<void>((resolve, reject) => {
      const out = fs.createWriteStream(part);
      res.pipe(out);
      out.on("finish", () => out.close(() => resolve()));
      out.on("error", reject);
      res.on("error", reject);
    });
    fs.renameSync(part, dest);
  },

  async insert(file, durationSec, title) {
    const raw = await evalScript(`ondeInsert(${JSON.stringify(file)}, ${durationSec})`);
    let res: any;
    try { res = JSON.parse(raw); } catch { throw new Error(raw || "Premiere n'a pas répondu"); }
    if (!res.ok) throw new Error(ERRORS[res.error] ?? res.error);
    return `« ${title} » posé sur A${res.track + 1} à ${timecode(res.start)}.`;
  },

  setDragData(dt, file, _sound: Sound) {
    // Format reconnu par Premiere pour les fichiers glissés depuis un panneau CEP.
    dt.setData("com.adobe.cep.dnd.file.0", file);
    dt.effectAllowed = "copy";
  },
};

applyHostTheme();
startPanel(host);
