// Interface du panneau Onde pour Premiere Pro, commune aux deux technologies d'Adobe :
//   - CEP (Premiere 2019 → aujourd'hui) : host-cep.ts
//   - UXP (Premiere 25.6 et plus) : host-uxp.ts
// Chaque technologie fournit un « Host » : fichiers, réseau, insertion dans la séquence, glisser-déposer.
import { formatDuration, search } from "../../src/search";
import type { Sound } from "../../src/types";

export const CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";

export interface Host {
  /** Le panneau peut glisser un fichier vers la timeline. */
  canDrag: boolean;
  /** Séparateur de chemin du système. */
  sep: string;
  /** Dossier des sons (le même que l'application Onde). */
  libraryDir(): Promise<string>;
  getJson(url: string): Promise<any>;
  /** Télécharge `url` vers `dest` (via un fichier .part), sauf si le fichier existe déjà. */
  download(url: string, dest: string): Promise<void>;
  /** Importe le fichier dans le chutier « Onde » et le pose à la tête de lecture, sur une piste audio libre. */
  insert(path: string, durationSec: number, title: string): Promise<string>;
  /** Remplit les données du glisser-déposer pour un fichier local. */
  setDragData(dt: DataTransfer, path: string, sound: Sound): void;
}

const PAGE = 60;

export function startPanel(host: Host): void {
  const state = {
    catalog: [] as Sound[],
    results: [] as Sound[],
    limit: PAGE,
    selId: null as string | null,
    playingId: null as string | null,
    libDir: "",
    local: new Map<string, string>(),
    inflight: new Map<string, Promise<string>>(),
    busy: new Set<string>(),
  };

  const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
  const listEl = $("list");
  const statusEl = $("status");
  const player = $<HTMLMediaElement>("player");
  const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
  const byId = (id: string | null) => state.catalog.find((s) => s.id === id) ?? null;
  const soundUrl = (s: Sound) => `${CDN}/sons/${encodeURIComponent(s.file)}`;

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
  const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

  function ensureLocal(s: Sound): Promise<string> {
    const known = state.local.get(s.id);
    if (known) return Promise.resolve(known);
    let job = state.inflight.get(s.id);
    if (job) return job;
    const dest = [state.libDir, s.code, s.file].join(host.sep);
    job = host.download(soundUrl(s), dest).then(() => {
      state.local.set(s.id, dest);
      state.inflight.delete(s.id);
      markReady(s.id);
      return dest;
    }, (e) => { state.inflight.delete(s.id); throw e; });
    state.inflight.set(s.id, job);
    return job;
  }

  async function insert(s: Sound): Promise<void> {
    if (state.busy.has(s.id)) return;
    state.busy.add(s.id);
    renderList();
    try {
      status(`Téléchargement de « ${s.title} »…`);
      const path = await ensureLocal(s);
      status("Insertion dans la séquence…");
      status(await host.insert(path, s.durationMs / 1000, s.title), "ok");
    } catch (e) {
      status(`Insertion impossible : ${errText(e)}`, "err");
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
      player.src = soundUrl(s);
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

  // ---------- Glisser-déposer ----------
  function markReady(id: string): void {
    const row = listEl.querySelector<HTMLElement>(`.row[data-id="${id}"]`);
    if (row && host.canDrag) { row.classList.add("ready"); row.setAttribute("draggable", "true"); }
  }

  listEl.addEventListener("dragstart", (e: DragEvent) => {
    const s = rowOf(e.target);
    const path = s ? state.local.get(s.id) : undefined;
    if (!s || !path || !e.dataTransfer) { e.preventDefault(); return; }
    host.setDragData(e.dataTransfer, path, s);
    status(`Lâchez « ${s.title} » dans la timeline ou le panneau Projet.`);
  });

  // Dès qu'on survole un son, on le prépare pour pouvoir le glisser sans attendre.
  listEl.addEventListener("mouseover", (e) => {
    if (!host.canDrag) return;
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
    const hint = host.canDrag ? "Glissez vers la timeline, ou cliquez Insérer" : "Cliquez Insérer pour poser le son à la tête de lecture";
    const rows = list.map((s) => {
      const sel = s.id === state.selId;
      const playing = s.id === state.playingId;
      const ready = host.canDrag && state.local.has(s.id);
      const busy = state.busy.has(s.id);
      return `<div class="row${sel ? " sel" : ""}${ready ? " ready" : ""}" data-id="${s.id}" draggable="${ready}" title="${hint}">
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

  void (async () => {
    try {
      state.libDir = await host.libraryDir();
      const data = await host.getJson(`${CDN}/catalogue/v1.json`);
      state.catalog = (data.sounds as Sound[]).sort((a, b) => a.title.localeCompare(b.title, "fr"));
      runSearch("");
      status(host.canDrag ? "Glissez un son vers la timeline, ou cliquez Insérer." : "Cliquez Insérer pour poser un son à la tête de lecture.");
    } catch (e) {
      status(`Impossible de charger la bibliothèque : ${errText(e)}`, "err");
    }
  })();
}
