// Panneau Onde pour Premiere Pro (UXP).
//
// - Cherche dans la même bibliothèque en ligne que l'application Onde (même recherche, mêmes synonymes).
// - Pré-écoute directement depuis la bibliothèque en ligne.
// - « Insérer » : télécharge le son dans le dossier Onde (le même que l'application),
//   l'importe dans un chutier « Onde » du projet, puis le pose à la tête de lecture,
//   sur la première piste audio libre (aucun clip existant n'est touché).
// - Premiere 27 et plus : on peut aussi glisser une ligne vers la timeline ou le panneau Projet.
import { formatDuration, search } from "../../src/search";
import type { Sound } from "../../src/types";

/* eslint-disable @typescript-eslint/no-explicit-any */
declare const require: (m: string) => any;
const ppro = require("premierepro");
const uxp = require("uxp");
const fs = require("fs");
const os = require("os");

const CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
const BIN = "Onde";
const PAGE = 60;

const state = {
  catalog: [] as Sound[],
  results: [] as Sound[],
  limit: PAGE,
  selId: null as string | null,
  playingId: null as string | null,
  libDir: "",
  local: new Map<string, string>(),      // son → chemin sur le disque
  inflight: new Map<string, Promise<string>>(),
  busy: new Set<string>(),
};

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const listEl = $("list");
const statusEl = $("status");
const player = $<HTMLVideoElement>("player");
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const byId = (id: string | null) => state.catalog.find((s) => s.id === id) ?? null;

/** Remonte l'arbre jusqu'à l'élément qui porte l'attribut (UXP n'a pas toujours closest ni dataset). */
function up(el: EventTarget | null, attr: string): HTMLElement | null {
  let n = el as HTMLElement | null;
  while (n && n !== listEl) {
    if (n.getAttribute?.(attr) != null) return n;
    n = n.parentElement;
  }
  return null;
}
const rowOf = (el: EventTarget | null) => byId(up(el, "data-id")?.getAttribute("data-id") ?? null);

function status(msg: string, kind: "" | "ok" | "err" = ""): void {
  statusEl.textContent = msg;
  statusEl.parentElement!.className = `foot ${kind}`;
}

// ---------- Version de Premiere ----------
function hostVersion(): number[] {
  const v = String(uxp.host?.version ?? "0");
  return v.split(".").map((n: string) => parseInt(n, 10) || 0);
}
const canDrag = hostVersion()[0] >= 27; // glisser-déposer depuis un panneau : Premiere 27.0 et plus

// ---------- Dossier des sons (partagé avec l'application Onde) ----------
const isWin = os.platform().startsWith("win");
const SEP = isWin ? "\\" : "/";
const join = (...parts: string[]) => parts.join(SEP);

async function exists(path: string): Promise<boolean> {
  try { await fs.lstat(path); return true; } catch { return false; }
}

/** L'application Onde écrit son dossier dans bibliotheque.txt ; sinon Documents/Onde. */
async function resolveLibDir(): Promise<string> {
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
}

/** Télécharge le son s'il n'est pas déjà sur le disque, et renvoie son chemin. */
function ensureLocal(s: Sound): Promise<string> {
  const known = state.local.get(s.id);
  if (known) return Promise.resolve(known);
  let job = state.inflight.get(s.id);
  if (job) return job;
  job = (async () => {
    const dir = join(state.libDir, s.code);
    const dest = join(dir, s.file);
    if (!(await exists(dest))) {
      await fs.mkdir(dir, { recursive: true }).catch(() => 0);
      const res = await fetch(`${CDN}/sons/${encodeURIComponent(s.file)}`);
      if (!res.ok) throw new Error(`téléchargement impossible (${res.status})`);
      const data = await res.arrayBuffer();
      const part = `${dest}.part`;
      await fs.writeFile(part, data);
      await fs.rename(part, dest);
    }
    state.local.set(s.id, dest);
    state.inflight.delete(s.id);
    markReady(s.id);
    return dest;
  })().catch((e) => { state.inflight.delete(s.id); throw e; });
  state.inflight.set(s.id, job);
  return job;
}

// ---------- Premiere : chutier, import, insertion ----------
const norm = (p: string) => p.replace(/\\/g, "/").toLowerCase();

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

/** Première piste audio libre entre start et end (en secondes) ; sinon une nouvelle piste. */
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

async function insert(s: Sound): Promise<void> {
  if (state.busy.has(s.id)) return;
  state.busy.add(s.id);
  renderList();
  try {
    const project = await ppro.Project.getActiveProject();
    if (!project) throw new Error("ouvrez d'abord un projet");
    const seq = await project.getActiveSequence();
    if (!seq) throw new Error("ouvrez une séquence dans la timeline");

    status(`Téléchargement de « ${s.title} »…`);
    const path = await ensureLocal(s);

    status("Import dans le projet…");
    const bin = await findOrCreateBin(project);
    let clip = await findClip(bin, path);
    if (!clip) {
      await project.importFiles([path], true, bin, false);
      clip = await findClip(bin, path);
    }
    if (!clip) throw new Error("le son n'a pas pu être importé");

    const pos = await seq.getPlayerPosition();
    const start = pos.seconds;
    const track = await freeAudioTrack(seq, start, start + s.durationMs / 1000);
    const editor = ppro.SequenceEditor.getEditor(seq);
    let ok = false;
    project.lockedAccess(() => {
      ok = project.executeTransaction((ca: any) => {
        ca.addAction(editor.createOverwriteItemAction(clip, pos, 0, track));
      }, `Onde : ${s.title}`);
    });
    if (!ok) throw new Error("Premiere a refusé l'insertion");
    status(`« ${s.title} » posé sur A${track + 1} à ${timecode(start)}.`, "ok");
  } catch (e) {
    status(`Insertion impossible : ${e instanceof Error ? e.message : e}`, "err");
  } finally {
    state.busy.delete(s.id);
    renderList();
  }
}

// ---------- Pré-écoute ----------
function togglePlay(s: Sound): void {
  if (state.playingId === s.id) {
    player.pause();
    state.playingId = null;
  } else {
    const local = state.local.get(s.id);
    player.src = local ? `file:///${norm(local).replace(/^\//, "")}` : `${CDN}/sons/${encodeURIComponent(s.file)}`;
    state.playingId = s.id;
    const p = player.play() as unknown as Promise<void> | undefined;
    p?.catch?.(() => { state.playingId = null; status("Pré-écoute indisponible dans cette version de Premiere.", "err"); renderList(); });
    void ensureLocal(s).catch(() => {}); // prépare le fichier pour l'insertion ou le glisser
  }
  state.selId = s.id;
  renderList();
}
player.addEventListener("ended", () => { state.playingId = null; renderList(); });
player.addEventListener("error", () => {
  if (state.playingId) status("Pré-écoute indisponible pour ce son.", "err");
  state.playingId = null;
  renderList();
});

// ---------- Glisser-déposer (Premiere 27+) ----------
const MIME: Record<string, string> = { wav: "audio/wav", mp3: "audio/mpeg", aif: "audio/aif", aiff: "audio/x-aiff", m4a: "audio/m4a" };

function fileUri(path: string): string {
  let p = path;
  if (/^[A-Za-z]:\\/.test(p)) p = "/" + p.replace(/\\/g, "/");
  return "file://" + encodeURI(p);
}

function markReady(id: string): void {
  const row = listEl.querySelector<HTMLElement>(`.row[data-id="${id}"]`);
  if (row && canDrag) { row.classList.add("ready"); row.setAttribute("draggable", "true"); }
}

listEl.addEventListener("dragstart", (e: DragEvent) => {
  const s = rowOf(e.target);
  const path = s ? state.local.get(s.id) : undefined;
  if (!s || !path || !e.dataTransfer) { e.preventDefault(); return; }
  const ext = s.file.split(".").pop()!.toLowerCase();
  e.dataTransfer.setData("text/plain", JSON.stringify({
    version: "1.0.0",
    items: [{ name: s.file, display_name: s.title, content_type: MIME[ext] ?? "audio/wav", uri: fileUri(path) }],
  }));
  e.dataTransfer.effectAllowed = "copyMove";
  e.dataTransfer.dropEffect = "copy";
  status(`Lâchez « ${s.title} » dans la timeline ou le panneau Projet.`);
});

// Dès qu'on survole ou sélectionne un son, on le prépare pour pouvoir le glisser.
listEl.addEventListener("mouseover", (e) => {
  if (!canDrag) return;
  const s = rowOf(e.target);
  if (s && !state.local.has(s.id)) void ensureLocal(s).catch(() => {});
});

// ---------- Affichage ----------
function waveBars(peaks: number[], bars = 16): string {
  let out = "";
  const step = peaks.length / bars;
  for (let i = 0; i < bars; i++) {
    const slice = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    const h = Math.max(2, Math.round(Math.max(...slice) * 20));
    out += `<i style="height:${h}px"></i>`;
  }
  return out;
}

function renderList(): void {
  const list = state.results.slice(0, state.limit);
  if (!list.length) {
    listEl.innerHTML = `<p class="empty">Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».</p>`;
    return;
  }
  const rows = list.map((s) => {
    const sel = s.id === state.selId;
    const playing = s.id === state.playingId;
    const ready = canDrag && state.local.has(s.id);
    const busy = state.busy.has(s.id);
    return `<div class="row${sel ? " sel" : ""}${ready ? " ready" : ""}" data-id="${s.id}" draggable="${ready}" title="${canDrag ? "Glissez vers la timeline, ou cliquez Insérer" : "Cliquez Insérer pour poser le son à la tête de lecture"}">
      <button class="play${playing ? " on" : ""}" data-act="play">${playing ? "❚❚" : "▶"}</button>
      <div class="info"><b>${esc(s.title)}</b><span>${esc(s.code)} · ${esc(s.tags.slice(0, 4).join(" · "))}</span></div>
      <div class="wave">${waveBars(s.peaks)}</div>
      <span class="dur mono muted">${formatDuration(s.durationMs)}</span>
      <button class="ins" data-act="insert" ${busy ? "disabled" : ""}>${busy ? "…" : "Insérer"}</button>
    </div>`;
  }).join("");
  const more = state.results.length > state.limit ? `<button class="more" data-act="more">Afficher plus (${state.results.length - state.limit})</button>` : "";
  const top = listEl.scrollTop;
  listEl.innerHTML = rows + more;
  listEl.scrollTop = top;
}

function runSearch(q: string): void {
  state.results = search(state.catalog, q);
  state.limit = PAGE;
  $("count").textContent = `${state.results.length} SONS`;
  listEl.scrollTop = 0;
  renderList();
}

listEl.addEventListener("click", (e) => {
  const act = up(e.target, "data-act")?.getAttribute("data-act");
  if (act === "more") { state.limit += PAGE * 2; renderList(); return; }
  const s = rowOf(e.target);
  if (!s) return;
  if (act === "play") togglePlay(s);
  else if (act === "insert") void insert(s);
  else { state.selId = s.id; renderList(); }
});

listEl.addEventListener("dblclick", (e) => {
  const s = rowOf(e.target);
  if (s) void insert(s);
});

let timer: ReturnType<typeof setTimeout> | undefined;
$<HTMLInputElement>("q").addEventListener("input", (e) => {
  const v = (e.target as HTMLInputElement).value;
  clearTimeout(timer);
  timer = setTimeout(() => runSearch(v), 120);
});

// ---------- Démarrage ----------
async function start(): Promise<void> {
  try {
    state.libDir = await resolveLibDir();
    const res = await fetch(`${CDN}/catalogue/v1.json`);
    if (!res.ok) throw new Error(`bibliothèque indisponible (${res.status})`);
    const data = await res.json();
    state.catalog = (data.sounds as Sound[]).sort((a, b) => a.title.localeCompare(b.title, "fr"));
    runSearch("");
    status(canDrag
      ? "Glissez un son vers la timeline, ou cliquez Insérer."
      : "Cliquez Insérer pour poser un son à la tête de lecture.");
  } catch (e) {
    status(`Impossible de charger la bibliothèque : ${e instanceof Error ? e.message : e}`, "err");
  }
}

void start();
