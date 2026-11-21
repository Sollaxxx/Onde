// Interface du panneau Onde, commune à Premiere Pro et DaVinci Resolve :
//   - CEP (Premiere 2019 → aujourd'hui) : host-cep.ts
//   - UXP (Premiere 25.6 et plus) : host-uxp.ts
//   - DaVinci Resolve Studio (Workflow Integration) : resolve/src/host-resolve.ts
// Chaque logiciel fournit un « Host » : fichiers, réseau, insertion dans la timeline, glisser-déposer.
import { formatDuration, search } from "../../src/search";
import type { Sound } from "../../src/types";
import { collate, errText, getLang, soundTitle, t, tn } from "../../src/i18n";

export const CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
/** Site d'Onde : comptes et sons d'équipe (Onde Équipe). */
export const SITE = "https://ondesound.com";

/** Contenu des équipes du compte connecté dans l'application Onde (sons et playlists partagés). */
export interface TeamContent {
  teams: { id: string; name: string }[];
  sounds: { teamId: string; id: string; title: string; fileName: string; durationMs: number; peaks: number[]; tags: string[]; format: string; url: string }[];
  playlists: { teamId: string; id: string; name: string; ids: string[] }[];
}

/** Même rangement que l'application (compte.rs) : <dossier des sons>/Equipes/<équipe>/<nom>_<id8>.<ext> */
export function folderName(name: string): string {
  const clean = [...name].map((c) => (c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? "_" : c)).join("").trim().replace(/^\.+|\.+$/g, "").trim().slice(0, 60);
  return clean || "Equipe";
}
export function teamFileName(id: string, fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const stem = folderName(dot > 0 ? fileName.slice(0, dot) : fileName);
  const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
  return `${stem}_${id.slice(0, 8)}.${ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? ext : "wav"}`;
}

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
  /** Note que ce son sert dans un montage : l'application Onde ne l'effacera jamais. */
  markUsed(path: string): Promise<void>;
  /** Message affiché quand on commence à glisser un son. */
  dropHint?(title: string): string;
  /** Glisser-déposer natif du système, à la place de setDragData (panneau Electron de Resolve). */
  startNativeDrag?(path: string): void;
  /** Sons et playlists des équipes du compte connecté dans l'application Onde (null : pas connecté, ou pas d'équipe). */
  teamContent?(): Promise<TeamContent | null>;
}

const PAGE = 60;

export function startPanel(host: Host): void {
  // Textes fixes de la page (index.html), traduits au démarrage
  document.documentElement.lang = getLang();
  const q = document.getElementById("q") as HTMLInputElement | null;
  if (q) q.placeholder = t("Décrivez un son : porte, whoosh, pluie…");
  const st = document.getElementById("status");
  if (st) st.textContent = t("Chargement de la bibliothèque…");
  const tag = document.querySelector(".tag");
  if (tag) tag.textContent = t("BÊTA");

  const state = {
    catalog: [] as Sound[],
    team: null as TeamContent | null,
    teamSounds: [] as Sound[],
    scope: "all", // "all", "team:<id>" ou "pl:<id>"
    query: "",
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
  const index = new Map<string, Sound>();
  const byId = (id: string | null) => (id ? index.get(id) ?? null : null);
  const soundUrl = (s: Sound) => s.remote ?? `${CDN}/sons/${encodeURIComponent(s.file)}`;
  const reindex = () => { index.clear(); for (const s of [...state.catalog, ...state.teamSounds]) index.set(s.id, s); };

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

  function ensureLocal(s: Sound): Promise<string> {
    const known = state.local.get(s.id);
    if (known) return Promise.resolve(known);
    let job = state.inflight.get(s.id);
    if (job) return job;
    const teamName = s.team ? state.team?.teams.find((x) => x.id === s.team)?.name ?? "" : "";
    const dest = s.team
      ? [state.libDir, "Equipes", folderName(teamName), teamFileName(s.id.slice(3), s.file)].join(host.sep)
      : [state.libDir, s.code, s.file].join(host.sep);
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
      status(t("Téléchargement de « {title} »…", { title: soundTitle(s) }));
      const path = await ensureLocal(s);
      status(t("Insertion dans la timeline…"));
      status(await host.insert(path, s.durationMs / 1000, soundTitle(s)), "ok");
      void host.markUsed(path).catch(() => {});
    } catch (e) {
      status(t("Insertion impossible : {e}", { e: errText(e) }), "err");
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
      p?.catch?.(() => { state.playingId = null; status(t("Pré-écoute indisponible dans cette version du logiciel."), "err"); renderList(); });
      void ensureLocal(s).catch(() => {}); // prépare le fichier pour l'insertion ou le glisser
    }
    state.selId = s.id;
    renderList();
  }
  player.addEventListener("ended", () => { state.playingId = null; renderList(); });
  player.addEventListener("error", () => {
    if (state.playingId) status(t("Pré-écoute indisponible pour ce son."), "err");
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
    if (host.startNativeDrag) { e.preventDefault(); host.startNativeDrag(path); } // glisser géré par le système (Resolve)
    else host.setDragData(e.dataTransfer, path, s);
    void host.markUsed(path).catch(() => {});
    status(host.dropHint ? host.dropHint(soundTitle(s)) : t("Lâchez « {title} » dans la timeline ou le panneau Projet.", { title: soundTitle(s) }));
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
      listEl.innerHTML = `<p class="empty">${t("Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».")}</p>`;
      return;
    }
    const hint = host.canDrag ? t("Glissez vers la timeline, ou cliquez Insérer") : t("Cliquez Insérer pour poser le son à la tête de lecture");
    const rows = list.map((s) => {
      const sel = s.id === state.selId;
      const playing = s.id === state.playingId;
      const ready = host.canDrag && state.local.has(s.id);
      const busy = state.busy.has(s.id);
      return `<div class="row${sel ? " sel" : ""}${ready ? " ready" : ""}" data-id="${s.id}" draggable="${ready}" title="${hint}">
        <button class="play${playing ? " on" : ""}" data-act="play">${playing ? "❚❚" : "▶"}</button>
        <div class="info"><b>${esc(soundTitle(s))}</b><span>${esc(s.code)} · ${esc(s.tags.slice(0, 4).join(" · "))}</span></div>
        <div class="wave">${waveBars(s.peaks)}</div>
        <span class="dur mono muted">${formatDuration(s.durationMs)}</span>
        <button class="ins" data-act="insert" ${busy ? "disabled" : ""}>${busy ? "…" : t("Insérer")}</button>
      </div>`;
    }).join("");
    const more = state.results.length > state.limit ? `<button class="more" data-act="more">${t("Afficher plus ({n})", { n: state.results.length - state.limit })}</button>` : "";
    const top = listEl.scrollTop;
    listEl.innerHTML = rows + more;
    listEl.scrollTop = top;
  }

  function scopeList(): Sound[] {
    if (state.scope.startsWith("team:")) return state.teamSounds.filter((s) => s.team === state.scope.slice(5));
    if (state.scope.startsWith("pl:")) {
      const p = state.team?.playlists.find((x) => x.id === state.scope.slice(3));
      return (p?.ids ?? []).map((id) => byId(id)).filter((s): s is Sound => !!s);
    }
    return [...state.catalog, ...state.teamSounds];
  }

  function runSearch(q: string): void {
    state.query = q;
    state.results = search(scopeList(), q);
    state.limit = PAGE;
    $("count").textContent = tn(state.results.length, "{n} SON", "{n} SONS");
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

  // ---------- Équipe (Onde Équipe) ----------
  function scopeMenu(): void {
    let sel = document.getElementById("scope") as HTMLSelectElement | null;
    if (!state.team?.teams.length) { sel?.remove(); state.scope = "all"; return; }
    if (!sel) {
      sel = document.createElement("select");
      sel.id = "scope";
      sel.setAttribute("aria-label", t("Où chercher"));
      sel.addEventListener("change", () => { state.scope = sel!.value; runSearch(state.query); });
      document.getElementById("q")?.parentElement?.appendChild(sel);
    }
    const opts = [`<option value="all">${t("Toute la bibliothèque")}</option>`];
    for (const team of state.team.teams) {
      opts.push(`<option value="team:${team.id}">${esc(t("Équipe · {name}", { name: team.name }))}</option>`);
      for (const p of state.team.playlists.filter((x) => x.teamId === team.id)) opts.push(`<option value="pl:${p.id}">— ${esc(p.name)}</option>`);
    }
    sel.innerHTML = opts.join("");
    if (![...sel.options].some((o) => o.value === state.scope)) state.scope = "all";
    sel.value = state.scope;
  }

  async function loadTeam(): Promise<void> {
    if (!host.teamContent) return;
    try {
      const c = await host.teamContent();
      state.team = c;
      const names = new Map((c?.teams ?? []).map((x) => [x.id, x.name]));
      state.teamSounds = (c?.sounds ?? []).map((r) => ({
        id: `eq-${r.id}`, title: r.title, titleEn: r.title, code: "EQP", category: names.get(r.teamId) ?? "", tags: r.tags ?? [],
        durationMs: r.durationMs, file: r.fileName, format: r.format, license: "Son de l'équipe", peaks: r.peaks ?? [],
        team: r.teamId, remote: r.url,
      }));
      reindex();
      scopeMenu();
      if (state.catalog.length) runSearch(state.query);
    } catch { /* pas de réseau : on garde ce qu'on avait */ }
  }
  // Les liens des sons d'équipe durent 12 h : on recharge régulièrement, et quand le panneau revient au premier plan
  setInterval(() => void loadTeam(), 10 * 60_000);
  window.addEventListener("focus", () => void loadTeam());

  void (async () => {
    try {
      state.libDir = await host.libraryDir();
      const data = await host.getJson(`${CDN}/catalogue/v1.json`);
      state.catalog = (data.sounds as Sound[]).sort((a, b) => collate(soundTitle(a), soundTitle(b)));
      reindex();
      runSearch("");
      void loadTeam();
      status(host.canDrag ? t("Glissez un son vers la timeline, ou cliquez Insérer.") : t("Cliquez Insérer pour poser un son à la tête de lecture."));
    } catch (e) {
      status(t("Impossible de charger la bibliothèque : {e}", { e: errText(e) }), "err");
    }
  })();
}
