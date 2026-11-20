// Panneau Onde pour DaVinci Resolve Studio (Workflow Integration, Electron).
// Processus principal : accès aux fichiers, au réseau et à Resolve. L'interface (renderer.js)
// lui parle par preload.js (modèle « sandbox » d'Electron, exigé depuis Resolve 19.0.2).
//
// WorkflowIntegration.node n'est pas dans le dépôt : c'est un module de Blackmagic Design livré avec Resolve.
// L'application Onde le copie depuis l'installation de Resolve au moment d'installer le panneau.
const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");
const fs = require("fs");
const os = require("os");
const https = require("https");

const PLUGIN_ID = "com.ondesound.resolve";
const BIN = "Onde";

let WorkflowIntegration = null;
try { WorkflowIntegration = require("./WorkflowIntegration.node"); } catch { /* panneau ouvert hors de Resolve */ }

let resolveObj = null;
let mainWindow = null;

/** Une erreur avec un code que l'interface sait traduire. */
const fail = (code) => Object.assign(new Error(code), { code });

async function getResolve() {
  if (resolveObj) return resolveObj;
  if (!WorkflowIntegration) throw fail("hors-resolve");
  if (!(await WorkflowIntegration.Initialize(PLUGIN_ID))) throw fail("pas-de-reponse");
  resolveObj = await WorkflowIntegration.GetResolve();
  if (!resolveObj) throw fail("pas-de-reponse");
  return resolveObj;
}

// ---------- Fichiers partagés avec l'application Onde ----------
const isWin = process.platform === "win32";

function configDir() {
  const home = os.homedir();
  return isWin
    ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "app.onde.desktop")
    : path.join(home, "Library", "Application Support", "app.onde.desktop");
}

function libraryDir() {
  const home = os.homedir();
  try {
    const hint = fs.readFileSync(path.join(configDir(), "bibliotheque.txt"), "utf8").trim();
    if (hint) return hint;
  } catch { /* application Onde absente : dossier par défaut */ }
  for (const docs of [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents")]) {
    if (fs.existsSync(path.join(docs, "Onde"))) return path.join(docs, "Onde");
  }
  return path.join(home, "Documents", "Onde");
}

function markUsed(file) {
  const cfg = configDir();
  fs.mkdirSync(cfg, { recursive: true });
  fs.appendFileSync(path.join(cfg, "sons-glisses.txt"), file + "\n", "utf8");
}

// ---------- Réseau ----------
function get(url, redirects = 3) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Onde-Resolve" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
        res.resume();
        resolve(get(new URL(res.headers.location, url).toString(), redirects - 1));
        return;
      }
      if (res.statusCode !== 200) { res.resume(); reject(fail(`http-${res.statusCode}`)); return; }
      resolve(res);
    }).on("error", reject);
  });
}

async function getJson(url) {
  const res = await get(url);
  const chunks = [];
  for await (const c of res) chunks.push(c);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function download(url, dest) {
  if (fs.existsSync(dest)) return;
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const part = `${dest}.part`;
  const res = await get(url);
  await new Promise((resolve, reject) => {
    const out = fs.createWriteStream(part);
    res.pipe(out);
    out.on("finish", () => out.close(() => resolve()));
    out.on("error", reject);
    res.on("error", reject);
  });
  fs.renameSync(part, dest);
}

// ---------- Insertion dans la timeline ----------
/** « 01:00:05:12 » (ou 01:00:05;12 en drop frame) → numéro d'image. */
function timecodeToFrames(tc, fps) {
  const p = String(tc).split(/[:;.]/).map(Number);
  if (p.length !== 4 || p.some(Number.isNaN)) return null;
  const base = Math.round(fps);
  return ((p[0] * 60 + p[1]) * 60 + p[2]) * base + p[3];
}

const samePath = (a, b) => {
  const n = (p) => path.normalize(String(p || "")).replace(/\\/g, "/");
  return isWin ? n(a).toLowerCase() === n(b).toLowerCase() : n(a) === n(b);
};

/** Chutier « Onde » à la racine du Media Pool (créé au besoin). */
async function ondeBin(mediaPool) {
  const root = await mediaPool.GetRootFolder();
  for (const f of (await root.GetSubFolderList()) || []) {
    if ((await f.GetName()) === BIN) return f;
  }
  return (await mediaPool.AddSubFolder(root, BIN)) || root;
}

/** Le son, importé une seule fois dans le chutier Onde. */
async function mediaItem(mediaPool, file) {
  const bin = await ondeBin(mediaPool);
  for (const clip of (await bin.GetClipList()) || []) {
    if (samePath(await clip.GetClipProperty("File Path"), file)) return clip;
  }
  const previous = await mediaPool.GetCurrentFolder();
  await mediaPool.SetCurrentFolder(bin);
  const items = await mediaPool.ImportMedia([file]);
  if (previous) await mediaPool.SetCurrentFolder(previous);
  return items && items[0];
}

/** Première piste audio sans clip entre `from` et `to` (images) ; 0 si aucune. */
async function freeAudioTrack(timeline, from, to) {
  const count = (await timeline.GetTrackCount("audio")) || 0;
  for (let i = 1; i <= count; i++) {
    let free = true;
    for (const item of (await timeline.GetItemListInTrack("audio", i)) || []) {
      if ((await item.GetStart()) < to && (await item.GetEnd()) > from) { free = false; break; }
    }
    if (free) return i;
  }
  return 0;
}

/** Pose le son à la tête de lecture, sur une piste audio libre (une nouvelle piste si toutes sont prises). */
async function insert(file, durationSec) {
  const resolve = await getResolve();
  const project = await (await resolve.GetProjectManager()).GetCurrentProject();
  if (!project) throw fail("noproject");
  const timeline = await project.GetCurrentTimeline();
  if (!timeline) throw fail("notimeline");
  const mediaPool = await project.GetMediaPool();

  const item = await mediaItem(mediaPool, file);
  if (!item) throw fail("import");

  const fps = parseFloat(await timeline.GetSetting("timelineFrameRate")) || parseFloat(await project.GetSetting("timelineFrameRate")) || 24;
  const tc = await timeline.GetCurrentTimecode();
  const start = timecodeToFrames(tc, fps) ?? (await timeline.GetStartFrame());
  const length = Math.max(1, Math.round(durationSec * fps));

  let track = await freeAudioTrack(timeline, start, start + length);
  if (!track) {
    await timeline.AddTrack("audio", "stereo");
    track = (await timeline.GetTrackCount("audio")) || 1;
  }
  const placed = await mediaPool.AppendToTimeline([
    { mediaPoolItem: item, startFrame: 0, endFrame: length - 1, mediaType: 2, trackIndex: track, recordFrame: start },
  ]);
  if (!placed || !placed.length) throw fail("refused");
  return { track, timecode: tc };
}

// ---------- Liaison avec l'interface ----------
/** Chaque appel renvoie { ok, value } ou { ok: false, error } : les erreurs restent lisibles côté interface. */
function handle(name, fn) {
  ipcMain.handle(`onde:${name}`, async (_e, ...args) => {
    try { return { ok: true, value: await fn(...args) }; }
    catch (e) { return { ok: false, error: e.code || e.message || String(e) }; }
  });
}

handle("libraryDir", async () => libraryDir());
handle("getJson", getJson);
handle("download", download);
handle("insert", insert);
handle("markUsed", async (file) => markUsed(file));

// Glisser un son du panneau vers la timeline ou le Media Pool de Resolve
ipcMain.on("onde:drag", (e, file) => {
  if (typeof file !== "string" || !fs.existsSync(file)) return;
  e.sender.startDrag({ file, icon: path.join(__dirname, "img", "drag.png") });
});

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 440,
    height: 760,
    minWidth: 320,
    minHeight: 360,
    title: "Onde",
    backgroundColor: "#1f1f1f",
    useContentSize: true,
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, "preload.js") },
  });
  mainWindow.setMenu(null);
  mainWindow.on("close", () => app.quit());
  mainWindow.loadFile("index.html");
}

app.whenReady().then(createWindow);
app.on("window-all-closed", () => app.quit());
app.on("quit", () => { try { WorkflowIntegration && WorkflowIntegration.CleanUp(); } catch { /* déjà fermé */ } });
