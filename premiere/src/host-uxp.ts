// Panneau Onde, version UXP : Premiere Pro 25.6 et plus.
// Gardée pour l'avenir (Adobe remplacera un jour CEP par UXP). Glisser-déposer : Premiere 27 et plus.
import { startPanel, type Host } from "./ui";

declare const require: (m: string) => any;
const ppro = require("premierepro");
const uxp = require("uxp");
const fs = require("fs");
const os = require("os");

const isWin = os.platform().startsWith("win");
const SEP = isWin ? "\\" : "/";
const join = (...parts: string[]) => parts.join(SEP);
const BIN = "Onde";
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

async function exists(p: string): Promise<boolean> {
  try { await fs.lstat(p); return true; } catch { return false; }
}

const major = parseInt(String(uxp.host?.version ?? "0").split(".")[0], 10) || 0;

async function findOrCreateBin(project: any): Promise<any> {
  const find = async () => {
    const root = await project.getRootItem();
    for (const item of await root.getItems()) {
      const folder = ppro.FolderItem.cast(item);
      if (folder && item.name === BIN) return folder;
    }
    return null;
  };
  let bin = await find();
  if (bin) return bin;
  const root = await project.getRootItem();
  project.lockedAccess(() => {
    project.executeTransaction((ca: any) => ca.addAction(root.createBinAction(BIN, false)), "Onde : créer le chutier");
  });
  bin = await find();
  return bin ?? root;
}

async function findClip(bin: any, path: string): Promise<any> {
  const want = norm(path);
  for (const item of await bin.getItems()) {
    const clip = ppro.ClipProjectItem.cast(item);
    if (!clip) continue;
    try { if (norm(await clip.getMediaFilePath()) === want) return clip; } catch { /* élément sans média */ }
  }
  return null;
}

/** Première piste audio libre entre start et end (secondes) ; sinon une nouvelle piste. */
async function freeAudioTrack(seq: any, start: number, end: number): Promise<number> {
  const count = await seq.getAudioTrackCount();
  for (let i = 0; i < count; i++) {
    const track = await seq.getAudioTrack(i);
    const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
    let free = true;
    for (const it of items ?? []) {
      const a = (await it.getStartTime()).seconds;
      const b = (await it.getEndTime()).seconds;
      if (a < end && b > start) { free = false; break; }
    }
    if (free) return i;
  }
  return count;
}

function timecode(sec: number): string {
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

const MIME: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", aif: "audio/aif", aiff: "audio/x-aiff", m4a: "audio/m4a" };

function fileUri(path: string): string {
  let p = path;
  if (/^[A-Za-z]:\\/.test(p)) p = "/" + p.replace(/\\/g, "/");
  return "file://" + encodeURI(p);
}

const host: Host = {
  canDrag: major >= 27, // glisser-déposer depuis un panneau UXP : Premiere 27.0 et plus
  sep: SEP,

  async libraryDir() {
    const home = os.homedir();
    const cfg = isWin ? join(home, "AppData", "Roaming", "app.onde.desktop") : join(home, "Library", "Application Support", "app.onde.desktop");
    try {
      const hint = String(await fs.readFile(join(cfg, "bibliotheque.txt"), { encoding: "utf-8" })).trim();
      if (hint) return hint;
    } catch { /* application Onde absente : dossier par défaut */ }
    for (const docs of [join(home, "Documents"), join(home, "OneDrive", "Documents")]) {
      if (await exists(join(docs, "Onde"))) return join(docs, "Onde");
    }
    return join(home, "Documents", "Onde");
  },

  async getJson(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`réponse ${res.status}`);
    return res.json();
  },

  async download(url, dest) {
    if (await exists(dest)) return;
    await fs.mkdir(dest.slice(0, dest.lastIndexOf(SEP)), { recursive: true }).catch(() => 0);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
    const part = `${dest}.part`;
    await fs.writeFile(part, await res.arrayBuffer());
    await fs.rename(part, dest);
  },

  async insert(path, durationSec, title) {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("ouvrez d'abord un projet");
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("ouvrez une séquence dans la timeline");
    const bin = await findOrCreateBin(project);
    let clip = await findClip(bin, path);
    if (!clip) {
      await project.importFiles([path], true, bin, false);
      clip = await findClip(bin, path);
    }
    if (!clip) throw new Error("le son n'a pas pu être importé");
    const pos = await seq.getPlayerPosition();
    const start = pos.seconds;
    const track = await freeAudioTrack(seq, start, start + durationSec);
    const editor = ppro.SequenceEditor.getEditor(seq);
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction((ca: any) => ca.addAction(editor.createOverwriteItemAction(clip, pos, 0, track)), `Onde : ${title}`);
    });
    if (!ok) throw new Error("Premiere a refusé l'insertion");
    return `« ${title} » posé sur A${track + 1} à ${timecode(start)}.`;
  },

  setDragData(dt, path, sound) {
    const ext = sound.file.split(".").pop()!.toLowerCase();
    dt.setData("text/plain", JSON.stringify({
      version: "1.0.0",
      items: [{ name: sound.file, display_name: sound.title, content_type: MIME[ext] ?? "audio/wav", uri: fileUri(path) }],
    }));
    dt.effectAllowed = "copyMove";
    dt.dropEffect = "copy";
  },
};

startPanel(host);
