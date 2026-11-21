// Panneau Onde, version CEP : Premiere Pro 2019 et plus (2022, 2023, 2024, 2025…).
// Le panneau tourne dans un Chromium avec Node.js (fichiers, réseau sans restriction),
// et parle à Premiere via un script ExtendScript (host.jsx).
import { SITE, startPanel, type Host, type TeamContent } from "./ui";
import type { Sound } from "../../src/types";
import { setLangPref, t } from "../../src/i18n";

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
    if (!cep) { reject(new Error(t("panneau ouvert hors de Premiere"))); return; }
    cep.evalScript(code, (res: string) => resolve(res));
  });
}

function get(url: string, redirects = 3, extra: Record<string, string> = {}): Promise<any> {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Onde-Premiere", ...extra } }, (res: any) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(res.headers.location, redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(new Error(t("réponse {code} du serveur", { code: res.statusCode }))); return; }
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
const errorText = (code: string) => (ERRORS[code] ? t(ERRORS[code]) : code);

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

/** Dossier de configuration de l'application Onde (partagé avec le panneau). */
function configDir(): string {
  const home = os.homedir();
  return isWin
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "app.onde.desktop")
    : path.join(home, "Library", "Application Support", "app.onde.desktop");
}

async function readJson(res: any): Promise<any> {
  const chunks: any[] = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

/** Sons et playlists des équipes, avec la session de l'application Onde (même ordinateur, même utilisateur). */
async function teamContent(): Promise<TeamContent | null> {
  let token = "";
  try { token = JSON.parse(fs.readFileSync(path.join(configDir(), "session.json"), "utf8")).token || ""; } catch { return null; }
  if (!token) return null;
  const auth = { Authorization: `Bearer ${token}` };
  const me = await readJson(await get(`${SITE}/api/compte/moi`, 0, auth)).catch(() => null);
  const teams = (me?.teams ?? []).filter((x: any) => x.active);
  if (!teams.length) return null;
  const out: TeamContent = { teams: teams.map((x: any) => ({ id: x.id, name: x.name })), sounds: [], playlists: [] };
  for (const team of teams) {
    const c = await readJson(await get(`${SITE}/api/equipe/${team.id}/contenu`, 0, auth)).catch(() => null);
    if (!c?.ok) continue;
    for (const snd of c.sounds) out.sounds.push({ ...snd, teamId: team.id });
    for (const p of c.playlists) out.playlists.push({ ...p, teamId: team.id });
  }
  return out;
}

const host: Host = {
  teamContent,
  canDrag: true,
  sep: path.sep,

  async libraryDir() {
    const home = os.homedir();
    const cfg = configDir();
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
    return readJson(await get(url));
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
    try { res = JSON.parse(raw); } catch { throw new Error(raw || t("Premiere n'a pas répondu")); }
    if (!res.ok) throw new Error(errorText(res.error));
    return t("« {title} » posé sur A{track} à {tc}.", { title, track: res.track + 1, tc: timecode(res.start) });
  },

  async markUsed(file) {
    const cfg = configDir();
    fs.mkdirSync(cfg, { recursive: true });
    fs.appendFileSync(path.join(cfg, "sons-glisses.txt"), file + "\n", "utf8");
  },

  setDragData(dt, file, _sound: Sound) {
    // Format reconnu par Premiere pour les fichiers glissés depuis un panneau CEP.
    dt.setData("com.adobe.cep.dnd.file.0", file);
    dt.effectAllowed = "copy";
  },
};

/** Langue de Premiere (fr_FR, en_US…) : le panneau parle la même langue que le logiciel. */
function applyHostLanguage(): void {
  try {
    const loc = String(JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || "");
    if (loc) setLangPref(loc.toLowerCase().startsWith("fr") ? "fr" : "en", false);
  } catch { /* langue du système */ }
}

applyHostTheme();
applyHostLanguage();
startPanel(host);
