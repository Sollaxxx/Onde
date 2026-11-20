import "./styles.css";
import { notesHtml } from "./nouveautes";
import * as api from "./api";
import { formatDuration, normalize, search } from "./search";
import type { Catalog, Playlist, Sound, Theme, UpdateInfo, View } from "./types";
import { PERSO_CATEGORY, toSound } from "./perso";
import { accueilScreen, STEPS, type Accueil } from "./bienvenue";
import { introWanted, playIntro } from "./intro";
import { playOutro } from "./outro";
import { launchWanted, playLaunch, type LaunchMode } from "./lancement";
import { createContributions } from "./contribuer";
import { t, tn, getLang, langPref, setLangPref, type LangPref, soundTitle, soundDesc, catLabel, formatLabel, licenseLabel, errText, collate } from "./i18n";

// ---------- État ----------
const store = {
  get<T>(key: string, fallback: T): T {
    try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback; } catch { return fallback; }
  },
  set(key: string, value: unknown): void {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* stockage indisponible : on continue sans */ }
  },
};

const state = {
  catalog: [] as Sound[],
  query: "",
  category: null as string | null,
  view: "tout" as View,
  // Sons personnels (dossiers ajoutés dans les Réglages) et playlists
  perso: [] as Sound[],
  userDirs: [] as string[],
  analyzing: 0, // sons personnels restant à analyser
  playlists: store.get<Playlist[]>("onde.playlists", []),
  playlistId: null as string | null,
  catsOpen: store.get<boolean>("onde.categoriesOuvertes", false),
  plMenu: false, // menu « Ajouter à une playlist » du son sélectionné
  plDelete: false, // confirmation de suppression de la playlist affichée
  selId: null as string | null,
  playingId: null as string | null,
  theme: store.get<Theme>("onde.theme", "clair"),
  compact: false,
  favs: new Set(store.get<string[]>("onde.favoris", [])),
  recents: store.get<string[]>("onde.recents", []),
  libDir: "",
  paths: new Map<string, string>(),
  intOpen: false,
  update: null as UpdateInfo | null,
  screen: "biblio" as "biblio" | "reglages" | "accueil" | "contrib",
  contribOpen: false, // contributions ouvertes par le serveur
  // Animation de lancement : "son" (par défaut), "muet" ou "off" (l'ancien réglage true/false est repris)
  launchAnim: ((v: unknown): LaunchMode => (v === false || v === "off" ? "off" : v === "muet" ? "muet" : "son"))(store.get<unknown>("onde.animDemarrage", "son")),
  premiere: null as api.PanelStatus | null,
  resolve: null as api.ResolveStatus | null,
  installingResolve: false,
  cleanup: null as api.CleanupInfo | null,
  // Hors ligne : seuls les sons déjà téléchargés sont écoutables et glissables
  news: null as string | null, // notes de version affichées après une mise à jour
  offline: false,
  local: new Set<string>(),
  onlyLocal: true,
  installing: false,
  feedback: null as null | { kind: api.FeedbackKind; message: string; email: string; sending: boolean; error: string },
  accueil: { step: 0, defaultDir: "", customDir: null, useCustom: false } as Accueil,
  origin: "test" as Catalog["origin"],
  cdn: "",
  limit: 150, // nombre de résultats affichés, augmenté par « Afficher plus »
  version: "0.1.0",
};

const audio = new Audio();
audio.preload = "auto";
const root = document.getElementById("app")!;
if (api.isMac && api.inTauri) document.body.classList.add("mac");

// ---------- Petites aides ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
// Index de tous les sons (banque + sons personnels), reconstruit quand l'une des deux listes change
let indexed: [Sound[], Sound[]] = [[], []];
let everything: Sound[] = [];
const index = new Map<string, Sound>();
function allSounds(): Sound[] {
  if (indexed[0] !== state.catalog || indexed[1] !== state.perso) {
    indexed = [state.catalog, state.perso];
    everything = [...state.catalog, ...state.perso];
    index.clear();
    for (const x of everything) index.set(x.id, x);
  }
  return everything;
}
const byId = (id: string | null) => (id ? (allSounds(), index.get(id) ?? null) : null);
const isLocal = (s: Sound) => !!s.local || state.local.has(s.id);
const playlistOf = (id: string | null) => state.playlists.find((p) => p.id === id) ?? null;
function savePlaylists(): void { store.set("onde.playlists", state.playlists); }
/** Tri alphabétique par titre, dans la langue de l'interface. */
function sortSounds(l: Sound[]): Sound[] {
  const key = new Map(l.map((s) => [s, normalize(soundTitle(s))]));
  return l.sort((a, b) => collate(key.get(a)!, key.get(b)!));
}

function waveSvg(peaks: number[], bars: number, cls = ""): string {
  const step = peaks.length / bars;
  let rects = "";
  for (let i = 0; i < bars; i++) {
    const slice = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
    const p = Math.max(0.04, Math.max(...slice));
    const h = (p * 20).toFixed(2);
    rects += `<rect x="${(i + 0.2).toFixed(1)}" y="${((20 - +h) / 2).toFixed(2)}" width="0.6" height="${h}" fill="currentColor"/>`;
  }
  return `<svg class="${cls}" viewBox="0 0 ${bars} 20" preserveAspectRatio="none" aria-hidden="true">${rects}</svg>`;
}

const ICON = {
  play: `<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 1.5v9l7.5-4.5z" fill="currentColor"/></svg>`,
  pause: `<svg width="12" height="12" viewBox="0 0 14 14" aria-hidden="true" fill="currentColor"><rect x="3" y="2" width="3" height="10"/><rect x="8" y="2" width="3" height="10"/></svg>`,
  grip: `<svg width="12" height="14" viewBox="0 0 12 14" aria-hidden="true" fill="currentColor"><rect x="1" y="1" width="3" height="3"/><rect x="8" y="1" width="3" height="3"/><rect x="1" y="5.5" width="3" height="3"/><rect x="8" y="5.5" width="3" height="3"/><rect x="1" y="10" width="3" height="3"/><rect x="8" y="10" width="3" height="3"/></svg>`,
  star: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7z"/></svg>`,
  starOn: `<svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M12 3l2.7 5.8 6.3.7-4.7 4.3 1.3 6.2L12 16.9 6.4 20l1.3-6.2L3 9.5l6.3-.7z"/></svg>`,
  search: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>`,
  plug: `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M9 2v6M15 2v6M6 8h12v4a6 6 0 0 1-12 0zM12 18v4"/></svg>`,
  gear: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(0 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(45 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(90 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(135 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(180 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(225 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(270 12 12)"/><rect x="10.6" y="1.6" width="2.8" height="4.2" transform="rotate(315 12 12)"/></g><circle cx="12" cy="12" r="6.3" fill="none" stroke="currentColor" stroke-width="2.4"/><circle cx="12" cy="12" r="2.1" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>`,
  sun: `<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.4" fill="none" stroke="currentColor" stroke-width="1.9"/><g fill="currentColor"><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(0 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(45 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(90 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(135 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(180 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(225 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(270 12 12)"/><rect x="11.2" y="1.5" width="1.6" height="3.4" transform="rotate(315 12 12)"/></g></svg>`,
  moon: `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.6A8.2 8.2 0 1 1 9.4 4a6.6 6.6 0 0 0 10.6 10.6z"/></svg>`,
  shrink: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M4 10h6V4M20 14h-6v6M10 10L3 3M14 14l7 7"/></svg>`,
  expand: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>`,
  list: `<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3" y="5" width="13" height="2.2"/><rect x="3" y="10.9" width="13" height="2.2"/><rect x="3" y="16.8" width="9" height="2.2"/><rect x="18" y="13" width="2.2" height="8"/><rect x="14.5" y="13" width="5.7" height="2.2"/></svg>`,
  chat: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/></svg>`,
  logo: `<svg width="20" height="20" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" fill="#002FA7"/><rect x="12" y="34" width="96" height="58" fill="#FFFFFF"/><g fill="#002FA7"><rect x="22" y="50" width="12" height="26"/><rect x="40" y="42" width="12" height="42"/><rect x="76" y="46" width="12" height="34"/></g><polygon points="50,4 78,4 78,20 64,32 50,20" fill="#E2231A"/><rect x="58" y="26" width="12" height="84" fill="#E2231A"/></svg>`,
  word: `<svg width="52" height="20" viewBox="0 0 256 100" role="img" aria-label="Onde"><g fill="none" stroke="currentColor" stroke-width="13"><circle cx="28" cy="52" r="21.5"/><path d="M72.5 80V24M72.5 52a21.5 21.5 0 0 1 43 0V80"/><circle cx="160" cy="52" r="21.5"/><path d="M247.5 52A21.5 21.5 0 1 0 242.5 65.8"/><path d="M204.5 52H254"/></g><polygon points="169,0 194,0 194,10 181.5,20 169,10" fill="#E2231A"/><rect x="175" y="14" width="13" height="66" fill="#E2231A"/></svg>`,
};

function toast(msg: string): void {
  document.querySelector(".toast")?.remove();
  const t = document.createElement("div");
  t.className = "toast";
  t.setAttribute("role", "status");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}

// ---------- Filtrage ----------
function visibleSounds(): Sound[] {
  let list = allSounds();
  const ids = (l: string[]) => l.map((id) => byId(id)).filter((s): s is Sound => !!s);
  if (state.view === "favoris") list = list.filter((s) => state.favs.has(s.id));
  if (state.view === "recents") list = ids(state.recents);
  if (state.view === "perso") list = state.perso;
  if (state.view === "playlist") list = ids(playlistOf(state.playlistId)?.ids ?? []);
  if (state.category) list = list.filter((s) => s.category === state.category);
  if (state.offline && state.onlyLocal) list = list.filter(isLocal);
  return search(list, state.query);
}

// ---------- Rendu ----------
let lastListKey = "";
function isDark(): boolean {
  return state.theme === "systeme" ? matchMedia("(prefers-color-scheme: dark)").matches : state.theme === "sombre";
}

function render(): void {
  const resolved = isDark() ? "sombre" : "clair";
  document.documentElement.dataset.theme = resolved;
  document.body.classList.toggle("compact", state.compact);

  const list = visibleSounds();
  if (!list.some((s) => s.id === state.selId)) state.selId = list[0]?.id ?? state.selId;
  const cur = byId(state.selId);
  const focused = document.activeElement?.id;
  // Le rendu remplace tout l'écran : on garde la position de défilement des zones qui défilent
  const SCROLLERS = [".list", ".side", ".detail", ".set-main", ".cb-main", ".cb-detail"];
  const scrolls = SCROLLERS.map((sel) => document.querySelector(sel)?.scrollTop ?? 0);

  if (state.screen === "accueil") {
    root.innerHTML = accueilScreen(state.accueil, state.theme, ICON.word, winButtons(), premiereAction(), resolveAction());
    return;
  }

  root.innerHTML = `
    ${titlebar()}
    ${state.update ? updateBanner(state.update) : "<div></div>"}
    ${state.screen === "reglages" ? settingsScreen() : state.screen === "contrib" ? contribScreen() : `
    <div class="body">
      ${sidebar()}
      ${mainList(list)}
      ${cur ? detail(cur) : `<aside class="detail"><p class="hint">${t("Sélectionnez un son.")}</p></aside>`}
    </div>
    ${cur ? minibar(cur) : ""}`}
    ${state.feedback ? feedbackDialog() : ""}
    ${state.news ? newsDialog(state.news) : ""}`;

  if (state.screen === "contrib" && focused?.startsWith("cb-")) {
    const el = document.getElementById(focused) as HTMLInputElement | null;
    el?.focus();
    try { if (el && el.type !== "checkbox") el.setSelectionRange(el.value.length, el.value.length); } catch { /* liste déroulante */ }
  }
  if (state.feedback && focused?.startsWith("fb-")) {
    const el = document.getElementById(focused) as HTMLInputElement | HTMLTextAreaElement | null;
    el?.focus();
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }
  if (focused === "pl-name") {
    const el = document.getElementById("pl-name") as HTMLInputElement | null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  }
  if (focused === "q") {
    const q = document.getElementById("q") as HTMLInputElement;
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  // Nouvelle recherche, catégorie ou vue : la liste repart du haut
  const listKey = `${state.screen}|${state.view}|${state.category}|${state.query}`;
  if (listKey !== lastListKey) scrolls[0] = 0;
  lastListKey = listKey;
  SCROLLERS.forEach((sel, i) => { const el = document.querySelector(sel); if (el && scrolls[i]) el.scrollTop = scrolls[i]; });
  syncProgress();
}

async function changeLibrary(path: string | null): Promise<void> {
  try {
    state.libDir = await api.setLibraryDir(path);
    state.paths.clear(); // les prochains sons iront dans le nouveau dossier
    toast(t("Les prochains sons seront rangés dans {dir}", { dir: state.libDir }));
  } catch (e) {
    toast(t("Dossier impossible à utiliser : {e}", { e: errText(e) }));
  }
  render();
}

function settingsScreen(): string {
  const sections: [string, string][] = [["r-app", t("Apparence")], ["r-lib", t("Dossier des sons")], ["r-keys", t("Raccourcis")], ["r-upd", t("Mises à jour")], ["r-about", t("À propos")]];
  const themes: [Theme, string][] = [["clair", `${ICON.sun}${t("Clair")}`], ["sombre", `${ICON.moon}${t("Sombre")}`], ["systeme", api.isMac ? t("Comme macOS") : t("Comme Windows")]];
  const langs: [LangPref, string][] = [["auto", api.isMac ? t("Comme macOS") : t("Comme Windows")], ["fr", "Français"], ["en", "English"]];
  const keys: [string, string][] = [[t("Rechercher"), `${api.MOD} K`], [t("Écouter / pause"), t("ESPACE")], [t("Son suivant / précédent"), "↓ ↑"], [t("Ajouter aux favoris"), "F"], [t("Fermer / revenir"), t("ÉCHAP")], [t("Glisser vers la timeline"), t("SOURIS")]];
  const kept = state.cleanup?.keptCount ?? 0;
  return `<div class="settings">
    <nav class="side" aria-label="${t("Sections des réglages")}">
      <div class="nav">
        <button data-act="back"><span>← ${t("Bibliothèque")}</span></button>
        <p class="eyebrow" style="margin-top:16px">${t("Réglages")}</p>
        ${sections.map(([id, label]) => `<button data-act="goto" data-goto="${id}"><span>${label}</span></button>`).join("")}
      </div>
    </nav>
    <main class="set-main">
      <h1>${t("Réglages")}</h1>

      <section id="r-app" aria-labelledby="h-app">
        <h2 id="h-app" class="eyebrow">${t("Apparence")}</h2>
        <div class="set-row">
          <div><b>${t("Langue")}</b><span>${t("La langue de l'interface. Les sons gardent leur nom dans les deux langues pour la recherche.")}</span></div>
          <div class="segmented" role="radiogroup" aria-label="${t("Langue")}">
            ${langs.map(([v, label]) => `<button role="radio" data-act="lang-set" data-value="${v}" aria-checked="${langPref() === v}">${label}</button>`).join("")}
          </div>
        </div>
        <div class="set-row">
          <div><b>${t("Mode")}</b><span>${t("Le mode sombre est plus doux en salle de montage.")}</span></div>
          <div class="segmented" role="radiogroup" aria-label="${t("Mode d'affichage")}">
            ${themes.map(([v, label]) => `<button role="radio" data-act="theme-set" data-value="${v}" aria-checked="${state.theme === v}">${label}</button>`).join("")}
          </div>
        </div>
        <div class="set-row">
          <div><b>${t("Animation au démarrage")}</b><span>${t("L'animation du logo à chaque ouverture d'Onde.")}</span></div>
          <div class="segmented" role="radiogroup" aria-label="${t("Animation au démarrage")}">
            ${([["son", t("Avec le son")], ["muet", t("Sans le son")], ["off", t("Désactivée")]] as const).map(([v, l]) => `<button role="radio" data-act="launch-set" data-value="${v}" aria-checked="${state.launchAnim === v}">${l}</button>`).join("")}
          </div>
        </div>
      </section>

      <section id="r-lib" aria-labelledby="h-lib">
        <h2 id="h-lib" class="eyebrow">${t("Dossier des sons")}</h2>
        <div class="set-row">
          <div><b>${t("Emplacement")}</b><span class="mono path">${esc(state.libDir)}</span></div>
          <div class="btns">
            <button class="secondary" data-act="open-folder">${t("Ouvrir")}</button>
            <button class="secondary strong" data-act="choose-folder">${t("Changer…")}</button>
          </div>
        </div>
        <div class="set-row set-dirs">
          <div><b>${t("Mes sons")}</b><span>${t("Ajoutez vos propres dossiers de sons : ils apparaissent dans « Mes sons », dans la recherche et dans vos playlists, à côté de la banque. Les fichiers restent où ils sont : Onde ne les copie, ne les déplace et ne les efface jamais.")}</span>
            ${state.userDirs.length ? `<ul class="dirs">${state.userDirs.map((d) => `<li><span class="mono path">${esc(d)}</span><button class="link-btn" data-act="dir-remove" data-dir="${esc(d)}">${t("Retirer")}</button></li>`).join("")}</ul>` : ""}
          </div>
          <div class="btns">
            ${state.userDirs.length ? `<button class="secondary" data-act="dir-rescan">${t("Actualiser")}</button>` : ""}
            <button class="secondary strong" data-act="dir-add">${t("Ajouter un dossier…")}</button>
          </div>
        </div>
        <div class="set-row">
          <div><b>${t("Revenir au dossier par défaut")}</b><span>${t("Documents\\Onde. Les sons déjà utilisés restent à leur place : vos projets de montage les retrouvent toujours.")}</span></div>
          <button class="secondary" data-act="reset-folder">${t("Rétablir")}</button>
        </div>
        ${state.cleanup ? `<div class="set-row">
          <div><b>${t("Nettoyage automatique")}</b><span>${t("Les sons seulement écoutés sont effacés s'ils ne servent plus. Ceux que vous avez glissés dans un logiciel de montage ne sont jamais effacés.")}${kept ? ` ${tn(kept, "{n} son conservé.", "{n} sons conservés.")}` : ""}</span></div>
          <div class="segmented" role="radiogroup" aria-label="${t("Nettoyage automatique")}">
            ${([[7, tn(7, "{n} jour", "{n} jours")], [30, tn(30, "{n} jour", "{n} jours")], [90, tn(90, "{n} jour", "{n} jours")], [0, t("Jamais")]] as const).map(([v, l]) => `<button role="radio" data-act="cleanup-set" data-value="${v}" aria-checked="${state.cleanup!.days === v}">${l}</button>`).join("")}
          </div>
        </div>` : ""}
      </section>

      <section id="r-keys" aria-labelledby="h-keys">
        <h2 id="h-keys" class="eyebrow">${t("Raccourcis")}</h2>
        <div class="keys">${keys.map(([label, k]) => `<div><span>${label}</span><span class="kbd">${k}</span></div>`).join("")}</div>
      </section>

      <section id="r-upd" aria-labelledby="h-upd">
        <h2 id="h-upd" class="eyebrow">${t("Mises à jour")}</h2>
        <div class="set-row">
          <div><b>Onde ${esc(state.version)} · ${t("bêta")}</b><span>${t("Chaque mise à jour est signée par l'équipe Onde. Les nouveaux sons arriveront sans mise à jour de l'application.")}</span></div>
          <button class="secondary strong" data-act="check-update">${t("Rechercher une mise à jour")}</button>
        </div>
      </section>

      <section id="r-about" class="about" aria-labelledby="h-about">
        <div>
          <h2 id="h-about">Onde ${esc(state.version)} · open-source</h2>
          <span>${t("Gratuit, et ça s'entend. Code publié sous licence AGPL-3.0.")}</span>
        </div>
        <div class="btns"><button class="secondary" data-act="open-site">ondesound.com</button><button class="secondary" data-act="replay-accueil">${t("Revoir l'accueil")}</button><span class="badge">${t("SOUTIEN BIENTÔT")}</span></div>
      </section>
    </main>
  </div>`;
}

function titlebar(): string {
  return `
  <header class="titlebar">
    <div class="brand" data-tauri-drag-region>${ICON.logo}${ICON.word}<span class="tag">${t("BÊTA")} ${esc(state.version)}</span></div>
    <div class="tb-actions">
      <button class="tb-btn tb-hide" data-act="integrations" aria-haspopup="true" aria-expanded="${state.intOpen}">${ICON.plug}${t("Intégrations")}</button>
      <button class="tb-btn tb-icon tb-hide" data-act="theme" aria-label="${isDark() ? t("Passer en mode clair") : t("Passer en mode sombre")}" title="${isDark() ? t("Mode clair") : t("Mode sombre")}">${isDark() ? ICON.sun : ICON.moon}</button>
      <button class="tb-btn" data-act="compact" aria-pressed="${state.compact}" title="${state.compact ? t("Revenir à la grande fenêtre") : t("Petite fenêtre toujours au premier plan")}">${state.compact ? ICON.expand : ICON.shrink}${state.compact ? t("Grande fenêtre") : t("Mode compact")}</button>
      <button class="tb-btn tb-hide" data-act="feedback" aria-haspopup="dialog">${ICON.chat}${t("Envoyer un retour")}</button>
      <button class="tb-btn tb-icon" data-act="settings" aria-pressed="${state.screen === "reglages"}" aria-label="${t("Réglages")}" title="${t("Réglages")}">${ICON.gear}</button>
      ${winButtons()}
    </div>
    ${state.intOpen ? integrations() : ""}
  </header>`;
}

function winButtons(): string {
  if (api.isMac && api.inTauri) return ""; // sur Mac : les feux tricolores d'Apple, en haut à gauche
  return `<div class="win">
        <button data-act="win-min" aria-label="${t("Réduire")}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor"/></svg></button>
        <button data-act="win-max" aria-label="${t("Agrandir")}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg></button>
        <button data-act="win-close" class="close" aria-label="${t("Fermer")}"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></button>
      </div>`;
}

// ---------- Mes contributions ----------
const contrib = createContributions({
  catalog: () => state.catalog,
  toast,
  render: () => render(),
  wave: waveSvg,
  duration: formatDuration,
});

function contribScreen(): string {
  const c = contrib.render();
  return `<div class="body">${sidebar()}${c.main}${c.detail}</div>`;
}

// ---------- Envoyer un retour ----------
function newsDialog(html: string): string {
  return `<div class="modal-bg" data-act="news-close">
    <div class="modal news" role="dialog" aria-modal="true" aria-labelledby="news-title">
      <header><p class="eyebrow">${t("Mise à jour installée")}</p><h2 id="news-title">${t("Nouveautés d'Onde {v}", { v: esc(state.version) })}</h2></header>
      <div class="news-body">${html}</div>
      <footer><button class="primary" data-act="news-close">${t("C'est parti")}</button></footer>
    </div>
  </div>`;
}

function feedbackDialog(): string {
  const f = state.feedback!;
  const kinds: [api.FeedbackKind, string][] = [["bug", t("Un bug")], ["idee", t("Une idée")], ["autre", t("Autre chose")]];
  const ph = f.kind === "bug" ? t("Ce que vous faisiez, ce qui s'est passé, ce que vous attendiez…") : f.kind === "idee" ? t("Ce qui vous ferait gagner du temps au montage…") : t("Votre message…");
  return `<div class="modal-bg" data-act="fb-close-bg">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fb-title">
      <header><h2 id="fb-title">${t("Envoyer un retour")}</h2><p>${t("Onde est en bêta : chaque message est lu, et c'est comme ça qu'il s'améliore.")}</p></header>
      <div class="segmented" role="radiogroup" aria-label="${t("Type de retour")}">
        ${kinds.map(([v, l]) => `<button role="radio" data-act="fb-kind" data-value="${v}" aria-checked="${f.kind === v}">${l}</button>`).join("")}
      </div>
      <label class="fld"><span>${t("Message")}</span><textarea id="fb-msg" rows="6" maxlength="4000" placeholder="${ph}">${esc(f.message)}</textarea></label>
      <label class="fld"><span>${t("Votre e-mail")} <em>· ${t("facultatif, pour qu'on puisse vous répondre")}</em></span><input id="fb-mail" type="email" value="${esc(f.email)}" placeholder="${t("vous@exemple.fr")}" autocomplete="email" /></label>
      <p class="fine">${t("La version d'Onde ({v}) et le système sont ajoutés automatiquement. Rien d'autre n'est envoyé.", { v: esc(state.version) })}</p>
      ${f.error ? `<p class="fb-err" role="alert">${esc(f.error)} <button class="link-btn" data-act="fb-mail">${t("Écrire par e-mail à la place")}</button></p>` : ""}
      <footer>
        <button class="secondary" data-act="fb-close">${t("Annuler")}</button>
        <button class="solid-btn" data-act="fb-send" ${f.sending ? "disabled" : ""}>${f.sending ? t("Envoi…") : t("Envoyer")}</button>
      </footer>
    </div>
  </div>`;
}

async function feedbackAction(act: string, el: HTMLElement): Promise<void> {
  const f = state.feedback;
  if (!f) return;
  switch (act) {
    case "fb-close-bg": if (el.classList.contains("modal-bg")) { state.feedback = null; break; } return;
    case "fb-close": state.feedback = null; break;
    case "fb-kind": f.kind = el.closest<HTMLElement>("[data-value]")!.dataset.value as api.FeedbackKind; break;
    case "fb-mail": {
      const body = `${f.message}\n\n—\nOnde ${state.version}`;
      try { await api.openUrl(`mailto:contact.ondesound@gmail.com?subject=${encodeURIComponent(t("Retour sur Onde"))}&body=${encodeURIComponent(body)}`); } catch { toast(t("Écrivez-nous à {mail}", { mail: "contact.ondesound@gmail.com" })); }
      return;
    }
    case "fb-send": {
      if (f.message.trim().length < 3) { f.error = t("Écrivez quelques mots avant d'envoyer."); break; }
      f.sending = true; f.error = ""; render();
      try {
        await api.sendFeedback(f.kind, f.message.trim(), f.email.trim());
        state.feedback = null;
        render();
        toast(t("Merci ! Votre retour est bien arrivé."));
        return;
      } catch (e) {
        f.sending = false;
        f.error = errText(e);
      }
      break;
    }
  }
  render();
}

// ---------- Écran d'accueil ----------
async function openAccueil(): Promise<void> {
  const a = state.accueil;
  a.step = 0;
  a.defaultDir = await api.defaultLibraryDir().catch(() => "Documents\\Onde");
  a.useCustom = !!state.libDir && state.libDir !== a.defaultDir;
  a.customDir = a.useCustom ? state.libDir : null;
  state.screen = "accueil";
  render();
}

async function finishAccueil(query = ""): Promise<void> {
  const a = state.accueil;
  const wanted = a.useCustom && a.customDir ? a.customDir : null;
  if ((wanted ?? a.defaultDir) !== state.libDir) {
    try { state.libDir = await api.setLibraryDir(wanted); state.paths.clear(); }
    catch (e) { toast(t("Dossier impossible à utiliser : {e}", { e: errText(e) })); }
  }
  store.set("onde.accueil", 1);
  await playOutro(() => {
    state.screen = "biblio";
    state.query = query;
    state.view = "tout";
    state.category = null;
    if (query) state.selId = visibleSounds()[0]?.id ?? state.selId;
    render();
  });
  if (!query) document.getElementById("q")?.focus();
}

async function accueilAction(act: string, el: HTMLElement): Promise<void> {
  const a = state.accueil;
  switch (act) {
    case "ob-theme": state.theme = el.closest<HTMLElement>("[data-value]")!.dataset.value as Theme; store.set("onde.theme", state.theme); break;
    case "ob-dir-default": a.useCustom = false; break;
    case "ob-dir-pick": {
      const picked = await api.chooseFolder(a.customDir ?? a.defaultDir);
      if (picked) { a.customDir = picked; a.useCustom = true; }
      else if (a.customDir) a.useCustom = true;
      break;
    }
    case "ob-back": a.step = Math.max(0, a.step - 1); break;
    case "ob-next":
      if (a.step === STEPS.length - 1) return finishAccueil();
      a.step++;
      break;
    case "ob-skip": return finishAccueil();
    case "ob-try": return finishAccueil(el.closest<HTMLElement>("[data-q]")!.dataset.q!);
  }
  render();
  document.querySelector<HTMLElement>(act === "ob-next" || act === "ob-back" ? ".ob-next" : `[data-act="${act}"]`)?.focus();
}

/** Bouton ou badge du panneau Premiere, selon ce qui est installé. */
function premiereAction(): string {
  const p = state.premiere;
  if (state.installing) return `<button class="badge-btn" disabled>${t("Installation…")}</button>`;
  if (!p?.bundled) return `<span class="badge">${t("BIENTÔT")}</span>`;
  if (p.installed === p.bundled) return `<span class="badge on">${t("INSTALLÉ")}</span>`;
  return `<button class="badge-btn" data-act="install-premiere">${p.installed ? t("Mettre à jour") : t("Installer")}</button>`;
}

async function installPremiere(): Promise<void> {
  state.installing = true;
  render();
  try {
    const v = await api.installPremierePanel();
    state.premiere = { installed: v, bundled: state.premiere?.bundled ?? v };
    toast(t("Panneau installé. Redémarrez Premiere Pro, puis Fenêtre → Extensions → Onde."));
  } catch (e) {
    toast(t("Installation impossible : {e}", { e: errText(e) }));
  }
  state.installing = false;
  render();
}

/** Bouton ou badge du panneau DaVinci Resolve, selon ce qui est installé. */
function resolveAction(): string {
  const r = state.resolve;
  if (state.installingResolve) return `<button class="badge-btn" disabled>${t("Installation…")}</button>`;
  if (!r?.bundled) return `<span class="badge">${t("BIENTÔT")}</span>`;
  if (r.installed === r.bundled) return `<span class="badge on">${t("INSTALLÉ")}</span>`;
  if (!r.resolve) return `<span class="badge" title="${t("DaVinci Resolve n'est pas installé sur cet ordinateur (ou sa version ne gère pas les panneaux).")}">${t("STUDIO REQUIS")}</span>`;
  return `<button class="badge-btn" data-act="install-resolve">${r.installed ? t("Mettre à jour") : t("Installer")}</button>`;
}

function resolveRow(): string {
  return `<div class="int"><span class="ini" aria-hidden="true">Dr</span><div class="meta"><b>DaVinci Resolve Studio</b><span>${t("Panneau Onde dans Resolve · Studio 18 et plus")}</span></div>${resolveAction()}</div>`;
}

async function installResolve(): Promise<void> {
  state.installingResolve = true;
  render();
  try {
    const v = await api.installResolvePanel();
    state.resolve = { installed: v, bundled: state.resolve?.bundled ?? v, resolve: true };
    toast(t("Panneau installé. Redémarrez DaVinci Resolve, puis Espace de travail → Intégrations de workflow → Onde."));
  } catch (e) {
    toast(t("Installation impossible : {e}", { e: errText(e) }));
  }
  state.installingResolve = false;
  render();
}

function integrations(): string {
  const pr = `<div class="int"><span class="ini" aria-hidden="true">Pr</span><div class="meta"><b>Premiere Pro</b><span>${t("Panneau Onde dans Premiere · 2019 et plus")}</span></div>${premiereAction()}</div>`;
  const rows = [
    ["Ae", "After Effects", t("Panneau Onde"), t("BIENTÔT"), false],
    ["Fc", "Final Cut Pro", t("Avec la version macOS"), t("BIENTÔT"), false],
    ["⇄", t("Tous les logiciels"), t("Glissez un son depuis Onde vers votre timeline"), t("ACTIF"), true],
  ] as const;
  return `<div class="popover" role="dialog" aria-label="${t("Intégrations logicielles")}">
    <header><h2>${t("Intégrations logicielles")}</h2><p>${t("Utilisez Onde directement dans votre logiciel de montage.")}</p></header>
    ${pr}
    ${resolveRow()}
    ${rows.map(([ini, name, info, badge, on]) => `<div class="int"><span class="ini" aria-hidden="true">${ini}</span><div class="meta"><b>${name}</b><span>${info}</span></div><span class="badge ${on ? "on" : ""}">${badge}</span></div>`).join("")}
  </div>`;
}

function updateBanner(u: UpdateInfo): string {
  return `<div class="update" role="status">
    <span class="tagline">${t("MISE À JOUR")}</span><b>${t("Onde {v} est prête.", { v: esc(u.version) })}</b>
    <span>${esc(u.notes.split("\n")[0] ?? "")}</span><span class="spacer"></span>
    <button data-act="update-later">${t("Plus tard")}</button>
    <button class="solid" data-act="update-install">${t("Installer et redémarrer")}</button>
  </div>`;
}

function sidebar(): string {
  const views: [View, string, number][] = [
    ["tout", t("Bibliothèque"), state.catalog.length + state.perso.length],
    ["perso", t("Mes sons"), state.perso.length],
    ["recents", t("Récents"), state.recents.length],
  ];
  const cats = new Map<string, { code: string; n: number }>();
  for (const s of state.catalog) {
    const c = cats.get(s.category) ?? { code: s.code, n: 0 };
    c.n++;
    cats.set(s.category, c);
  }
  const cur = (v: View) => state.screen === "biblio" && state.view === v && !state.category;
  const origin = state.origin === "en ligne" ? t("en ligne") : state.origin === "cache" ? t("hors ligne") : t("sons de test");
  return `<nav class="side" aria-label="${t("Navigation")}">
    <div class="nav">${views.map(([v, label, n]) => `<button data-view="${v}" aria-current="${cur(v)}"><span>${label}</span><span class="mono">${v === "perso" && state.analyzing ? "…" : n}</span></button>`).join("")}
      ${state.contribOpen ? `<button data-act="contrib" aria-current="${state.screen === "contrib"}"><span>${t("Mes contributions")}</span><span class="mono">+</span></button>` : ""}</div>
    <div class="nav">
      <button class="nav-fold" data-act="cats-toggle" aria-expanded="${state.catsOpen}"><span class="eyebrow">${t("Catégories UCS")} · ${cats.size}</span><span class="fold" aria-hidden="true">${state.catsOpen ? "−" : "+"}</span></button>
      ${state.catsOpen ? [...cats].sort((a, b) => collate(catLabel(a[0]), catLabel(b[0]))).map(([cat, { code }]) => `<button data-cat="${esc(cat)}" aria-current="${state.category === cat}"><span>${esc(catLabel(cat))}</span><span class="mono">${code}</span></button>`).join("") : ""}
    </div>
    <div class="nav"><p class="eyebrow">${t("Favoris")}</p>
      <button data-view="favoris" aria-current="${cur("favoris")}"><span>${ICON.starOn}${t("Titres likés")}</span><span class="mono">${state.favs.size}</span></button>
      ${state.playlists.map((p) => `<button data-act="pl-open" data-pl="${p.id}" aria-current="${state.screen === "biblio" && state.view === "playlist" && state.playlistId === p.id}"><span>${ICON.list}${esc(p.name)}</span><span class="mono">${p.ids.length}</span></button>`).join("")}
      <button class="nav-add" data-act="pl-new"><span>+ ${t("Nouvelle playlist")}</span></button>
    </div>
    <div class="folder"><span class="eyebrow">${t("Bibliothèque")} · ${origin}</span><span class="path" style="margin-bottom:8px">${tn(state.catalog.length, "{n} son", "{n} sons")}${state.perso.length ? ` + ${t("{n} à vous", { n: state.perso.length })}` : ""}</span><span class="eyebrow">${t("Dossier local")}</span><span class="path">${esc(state.libDir)}</span><button class="link-btn" data-act="open-folder">${t("Ouvrir le dossier")}</button></div>
  </nav>`;
}

function mainList(list: Sound[]): string {
  const counts = new Map<string, number>();
  for (const s of allSounds()) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const cats = [...counts].sort((a, b) => (a[0] === PERSO_CATEGORY ? -1 : b[0] === PERSO_CATEGORY ? 1 : collate(catLabel(a[0]), catLabel(b[0]))));
  const pl = state.view === "playlist" ? playlistOf(state.playlistId) : null;
  const n = state.local.size;
  return `<main class="main">
    ${pl ? `<div class="pl-head">
      <label class="sr" for="pl-name">${t("Nom de la playlist")}</label>
      <input id="pl-name" class="pl-name" value="${esc(pl.name)}" maxlength="60" spellcheck="false" />
      ${state.plDelete
        ? `<span class="pl-confirm">${t("Supprimer « {name} » ? Les sons ne sont pas effacés.", { name: esc(pl.name) })} <button class="secondary" data-act="pl-delete-no">${t("Annuler")}</button><button class="secondary danger" data-act="pl-delete-yes">${t("Supprimer")}</button></span>`
        : `<button class="secondary" data-act="pl-delete">${t("Supprimer la playlist")}</button>`}
    </div>` : ""}
    <div class="searchbar">${ICON.search}
      <label for="q" class="sr">${t("Rechercher un son")}</label>
      <input id="q" type="search" value="${esc(state.query)}" placeholder="${t("Décrivez un son : « porte qui grince », « whoosh »…")}" autocomplete="off" spellcheck="false" />
      <span class="mono" style="color:var(--muted);border:1px solid var(--line);padding:3px 6px">${api.MOD} K</span>
    </div>
    ${state.offline ? `<div class="offline-bar" role="status"><span><b>${t("Hors ligne")}</b> · ${tn(n, "{n} son disponible sur cet ordinateur", "{n} sons disponibles sur cet ordinateur")}</span>
      <button class="link-btn" data-act="offline-toggle">${state.onlyLocal ? t("Afficher toute la bibliothèque") : t("Seulement les sons disponibles")}</button></div>` : ""}
    <div class="chips">
      <label class="cat-select"><span class="sr">${t("Catégorie")}</span>
        <select id="cat-select">
          <option value="">${t("Toutes les catégories")}</option>
          ${cats.map(([c, k]) => `<option value="${esc(c)}" ${state.category === c ? "selected" : ""}>${esc(catLabel(c))} (${k})</option>`).join("")}
        </select>
      </label>
      ${state.category ? `<button class="chip" data-cat="" aria-pressed="false">${t("Effacer le filtre")} ✕</button>` : ""}
      <span class="count mono">${tn(list.length, "{n} SON", "{n} SONS")}</span>
    </div>
    <div class="list" role="listbox" aria-label="${t("Résultats")}">
      ${list.length ? list.slice(0, state.limit).map(row).join("") : `<p class="empty">${emptyText()}</p>`}
      ${list.length > state.limit ? `<button class="more" data-act="more">${t("Afficher plus ({n} autres sons)", { n: list.length - state.limit })}</button>` : ""}
    </div>
  </main>`;
}

function emptyText(): string {
  if (state.offline && state.onlyLocal && !state.local.size) return t("Hors ligne, et aucun son n'est encore sur cet ordinateur. Les sons que vous écoutez en ligne restent ensuite disponibles hors ligne.");
  if (state.offline && state.onlyLocal && !state.query) return t("Aucun son disponible hors ligne dans cette sélection.");
  if (state.view === "favoris" && !state.favs.size) return t("Aucun titre liké pour l'instant. Touchez l'étoile d'un son, ou la touche F.");
  if (state.view === "perso" && !state.userDirs.length) return t("Ajoutez vos propres dossiers de sons dans Réglages → Mes sons : ils apparaîtront ici et dans la recherche, à côté de la banque.");
  if (state.view === "perso" && state.analyzing) return t("Lecture de vos dossiers…");
  if (state.view === "playlist" && !playlistOf(state.playlistId)?.ids.length) return t("Playlist vide. Sélectionnez un son, puis « Ajouter à une playlist » dans le panneau de droite.");
  if (state.view === "recents" && !state.recents.length) return t("Les sons que vous écoutez apparaîtront ici.");
  return t("Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».");
}

function row(s: Sound): string {
  const sel = s.id === state.selId;
  const playing = s.id === state.playingId && !audio.paused;
  const away = state.offline && !isLocal(s);
  const title = esc(soundTitle(s));
  return `<div class="row${away ? " away" : ""}" role="option" data-id="${s.id}" aria-selected="${sel}" title="${away ? t("Hors ligne : ce son n'est pas encore sur cet ordinateur") : t("Glissez vers votre timeline")}">
    <button class="play ${playing ? "on" : ""}" data-act="play" aria-label="${playing ? t("Pause") : t("Écouter")} ${title}">${playing ? ICON.pause : ICON.play}</button>
    <div class="t"><b>${title}</b><span>${s.tags.map(esc).join(" · ")}</span></div>
    <span class="code">${s.code}</span>
    <div class="wave">${waveSvg(s.peaks, 60)}</div>
    <span class="dur">${formatDuration(s.durationMs)}</span>
    <button class="row-fav" data-act="fav-row" aria-pressed="${state.favs.has(s.id)}" aria-label="${state.favs.has(s.id) ? t("Retirer des titres likés") : t("Ajouter aux titres likés")}">${state.favs.has(s.id) ? ICON.starOn : ICON.star}</button>
    <span class="grip" aria-hidden="true">${ICON.grip}</span>
  </div>`;
}

function detail(s: Sound): string {
  const playing = s.id === state.playingId && !audio.paused;
  const fav = state.favs.has(s.id);
  const desc = soundDesc(s);
  return `<aside class="detail" aria-label="${t("Son sélectionné")}">
    <div style="display:grid;gap:6px"><span class="eyebrow">${s.code} · ${formatDuration(s.durationMs)}</span><h2>${esc(soundTitle(s))}</h2></div>
    <div class="bigwave" data-drag="${s.id}" title="${t("Glissez la forme d'onde vers votre timeline")}">
      ${waveSvg(s.peaks, 110, "base")}${waveSvg(s.peaks, 110, "played")}<span class="head" hidden></span>
    </div>
    <div class="transport">
      <button class="play big ${playing ? "on" : ""}" data-act="play-sel" aria-label="${playing ? t("Pause") : t("Écouter")}">${playing ? ICON.pause : ICON.play}</button>
      <span class="mono" id="time">00:00.00 / ${formatDuration(s.durationMs)}</span>
      <button class="sq-btn" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? t("Retirer des titres likés") : t("Ajouter aux titres likés")}">${fav ? ICON.starOn : ICON.star}</button>
    </div>
    <div class="pl-add">
      <button class="secondary" data-act="pl-menu" aria-expanded="${state.plMenu}">${ICON.list}${t("Ajouter à une playlist")}</button>
      ${state.plMenu ? `<div class="pl-menu" role="menu">
        ${state.playlists.map((p) => `<button role="menuitemcheckbox" data-act="pl-toggle" data-pl="${p.id}" aria-checked="${p.ids.includes(s.id)}"><span class="box" aria-hidden="true">${p.ids.includes(s.id) ? "✓" : ""}</span>${esc(p.name)}</button>`).join("")}
        <button role="menuitem" data-act="pl-new-with"><span class="box" aria-hidden="true">+</span>${t("Nouvelle playlist avec ce son")}</button>
      </div>` : ""}
    </div>
    ${desc ? `<p class="desc">${esc(desc)}</p>` : ""}
    <dl class="facts">
      <div><dt>${t("Format")}</dt><dd>${esc(formatLabel(s.format))}</dd></div>
      <div><dt>${t("Catégorie")}</dt><dd>${esc(catLabel(s.category))}</dd></div>
      <div><dt>${t("Licence")}</dt><dd>${s.license === "CC0" ? t("CC0 · sans crédit obligatoire") : esc(licenseLabel(s.license))}</dd></div>
      ${s.local ? `<div><dt>${t("Fichier")}</dt><dd class="path">${esc(s.file)}</dd></div>` : `<div><dt>${t("Code UCS")}</dt><dd>${s.code}</dd></div>`}
    </dl>
    <div class="tags">${s.tags.map((x) => `<span>${esc(x)}</span>`).join("")}</div>
    ${s.credit ? `<p class="credit">${t("Son :")} <button class="link-btn" data-act="source" title="${t("Ouvrir la page du son")}">${esc(s.credit)} ↗</button></p>` : ""}
    <div class="actions">
      <button class="primary" data-drag="${s.id}">${t("Glissez-moi dans votre timeline")}<span aria-hidden="true">⤓</span></button>
      <button class="secondary" data-act="reveal">${t("Afficher dans le dossier")}</button>
      <p class="hint">${t("Astuce : vous pouvez aussi attraper n'importe quelle ligne de la liste.")}</p>
    </div>
  </aside>`;
}

function minibar(s: Sound): string {
  const playing = s.id === state.playingId && !audio.paused;
  return `<div class="minibar">
    <div class="info"><button class="play big ${playing ? "on" : ""}" data-act="play-sel" aria-label="${playing ? t("Pause") : t("Écouter")}">${playing ? ICON.pause : ICON.play}</button>
      <div><b>${esc(soundTitle(s))}</b><span class="mono" style="color:var(--muted)">${s.code} · ${formatDuration(s.durationMs)}</span></div></div>
    <button class="primary" data-drag="${s.id}">${t("Glissez dans la timeline")}<span aria-hidden="true">⤓</span></button>
  </div>`;
}

// ---------- Lecture ----------
const inflight = new Map<string, Promise<string>>();

async function localPath(s: Sound): Promise<string> {
  if (s.local) return s.local; // son personnel : déjà sur l'ordinateur
  const known = state.paths.get(s.id);
  if (known) return known;
  let job = inflight.get(s.id);
  if (!job) {
    job = api.ensureLocal(s.id).then(
      (p) => { if (p) { state.paths.set(s.id, p); state.local.add(s.id); } inflight.delete(s.id); return p; },
      (e) => { inflight.delete(s.id); throw e; },
    );
    inflight.set(s.id, job);
  }
  return job;
}

async function togglePlay(id: string): Promise<void> {
  const s = byId(id);
  if (!s) return;
  if (state.playingId === id && !audio.paused) { audio.pause(); render(); return; }
  state.selId = id;
  if (state.offline && !isLocal(s)) { toast(t("Hors ligne : ce son n'est pas encore sur cet ordinateur.")); render(); return; }
  try {
    if (state.playingId !== id) {
      if (state.cdn && !state.offline && !s.local) {
        audio.src = api.streamUrl(state.cdn, s); // la lecture démarre tout de suite…
        void localPath(s).catch(() => {});      // …pendant que le fichier arrive sur le disque
      } else {
        audio.src = await api.audioUrl(s, await localPath(s));
      }
      state.playingId = id;
    }
    await audio.play();
    state.recents = [id, ...state.recents.filter((r) => r !== id)].slice(0, 50);
    store.set("onde.recents", state.recents);
  } catch (e) {
    toast(t("Lecture impossible : {e}", { e: errText(e) }));
  }
  render();
}

function syncProgress(): void {
  const s = byId(state.selId);
  const played = document.querySelector<SVGElement>(".bigwave .played");
  const head = document.querySelector<HTMLElement>(".bigwave .head");
  const time = document.getElementById("time");
  if (!s || !played || !head) return;
  const active = state.playingId === s.id && audio.duration > 0;
  const ratio = active ? Math.min(1, audio.currentTime / audio.duration) : 0;
  played.style.clipPath = `inset(0 ${(100 - ratio * 100).toFixed(2)}% 0 0)`;
  head.hidden = !active;
  head.style.left = `calc(${(ratio * 100).toFixed(2)}% - 1px)`;
  if (time) time.textContent = `${formatDuration((active ? audio.currentTime : 0) * 1000)} / ${formatDuration(s.durationMs)}`;
}

audio.addEventListener("ended", () => render());
// La lecture en ligne échoue (connexion perdue) : on bascule sur le fichier local s'il existe
audio.addEventListener("error", () => {
  const s = byId(state.playingId);
  if (!s || !audio.src.startsWith("http")) return;
  if (!navigator.onLine) goOffline();
  if (state.local.has(s.id)) {
    void localPath(s).then(async (p) => { audio.src = await api.audioUrl(s, p); await audio.play(); render(); }).catch(() => {});
  } else {
    state.playingId = null;
    toast(t("Lecture impossible : pas de connexion, et ce son n'est pas encore sur cet ordinateur."));
    render();
  }
});

// ---------- Hors ligne ----------
function goOffline(): void {
  if (state.offline) return;
  state.offline = true;
  render();
}
window.addEventListener("offline", goOffline);
window.addEventListener("online", async () => {
  if (!state.offline) return;
  try {
    const cat = await api.getCatalog();
    if (cat.origin === "en ligne") {
      state.catalog = sortSounds(cat.sounds);
      state.cdn = cat.cdn;
      state.origin = cat.origin;
    }
  } catch { /* on réessaiera au prochain retour de connexion */ }
  state.offline = state.origin === "cache";
  if (!state.offline) toast(t("Connexion retrouvée : toute la bibliothèque est disponible."));
  render();
});
(function loop() { if (!audio.paused) syncProgress(); requestAnimationFrame(loop); })();

// ---------- Glisser-déposer vers le logiciel de montage ----------
let pending: { id: string; x: number; y: number } | null = null;
let dragging = false;
let mouseDown = false;

root.addEventListener("pointerdown", (e) => {
  const target = e.target as HTMLElement;
  if (e.button !== 0 || target.closest("[data-act]")) return;
  const el = target.closest<HTMLElement>("[data-drag], .row");
  if (!el) return;
  const id = el.dataset.drag ?? el.dataset.id!;
  pending = { id, x: e.clientX, y: e.clientY };
  mouseDown = true;
  const s = byId(id);
  if (s) void localPath(s); // on prépare le fichier dès qu'on l'attrape
});

root.addEventListener("pointermove", async (e) => {
  if (!pending || dragging || !(e.buttons & 1)) return;
  if (Math.hypot(e.clientX - pending.x, e.clientY - pending.y) < 6) return;
  const s = byId(pending.id);
  pending = null;
  if (!s) return;
  if (state.offline && !isLocal(s)) { toast(t("Hors ligne : ce son n'est pas encore sur cet ordinateur.")); return; }
  dragging = true;
  try {
    const ready = state.paths.has(s.id);
    if (!ready) toast(t("Téléchargement du son…"));
    const path = await localPath(s);
    if (!ready && !mouseDown) { toast(t("Son prêt : attrapez-le à nouveau pour le glisser.")); return; }
    await api.dragOut([path]);
    if (!s.local) void api.markDragged(path).catch(() => {}); // utilisé dans un montage : ne sera jamais effacé
  } catch (err) {
    toast(api.inTauri ? t("Glisser impossible : {e}", { e: errText(err) }) : t("Le glisser-déposer vers un logiciel fonctionne dans l'application Onde, pas dans le navigateur."));
  } finally {
    dragging = false;
  }
});

window.addEventListener("pointerup", () => { pending = null; mouseDown = false; });

// ---------- Actions ----------
root.addEventListener("click", async (e) => {
  const el = e.target as HTMLElement;
  const rowEl = el.closest<HTMLElement>(".row");
  const act = el.closest<HTMLElement>("[data-act]")?.dataset.act;
  const view = el.closest<HTMLElement>("[data-view]")?.dataset.view as View | undefined;
  const catBtn = el.closest<HTMLElement>("[data-cat]");

  if (state.intOpen && !el.closest(".popover") && act !== "integrations") { state.intOpen = false; render(); }
  if (state.plMenu && !el.closest(".pl-add")) { state.plMenu = false; render(); }
  if (view) { if (state.screen === "contrib") { contrib.stop(); state.screen = "biblio"; } state.screen = "biblio"; state.view = view; state.playlistId = null; state.plDelete = false; state.category = null; state.limit = 150; render(); return; }
  if (catBtn) { if (state.screen === "contrib") { contrib.stop(); state.screen = "biblio"; } state.category = catBtn.dataset.cat || null; state.limit = 150; render(); return; }

  if (act?.startsWith("ob-")) { await accueilAction(act, el); return; }
  if (act?.startsWith("fb-")) { await feedbackAction(act, el); return; }
  if (act?.startsWith("cb-")) { await contrib.action(act, el); return; }
  if (act === "contrib") { state.screen = "contrib"; render(); return; }
  if (state.feedback) return;

  switch (act) {
    case "play": if (rowEl) await togglePlay(rowEl.dataset.id!); return;
    case "play-sel": if (state.selId) await togglePlay(state.selId); return;
    case "fav": toggleFav(); return;
    case "fav-row": toggleFav(el.closest<HTMLElement>(".row")?.dataset.id ?? null); return;
    case "cats-toggle": state.catsOpen = !state.catsOpen; store.set("onde.categoriesOuvertes", state.catsOpen); render(); return;
    case "pl-open": openPlaylist(el.closest<HTMLElement>("[data-pl]")!.dataset.pl!); return;
    case "pl-new": openPlaylist(newPlaylist().id); document.getElementById("pl-name")?.focus(); (document.getElementById("pl-name") as HTMLInputElement | null)?.select(); return;
    case "pl-new-with": { const p = newPlaylist(); if (state.selId) p.ids.push(state.selId); savePlaylists(); state.plMenu = false; toast(t("Ajouté à « {name} »", { name: p.name })); render(); return; }
    case "pl-menu": state.plMenu = !state.plMenu; render(); return;
    case "pl-toggle": {
      const p = playlistOf(el.closest<HTMLElement>("[data-pl]")!.dataset.pl!);
      const id = state.selId;
      if (!p || !id) return;
      if (p.ids.includes(id)) p.ids = p.ids.filter((x) => x !== id); else p.ids.push(id);
      savePlaylists(); render(); return;
    }
    case "pl-delete": state.plDelete = true; render(); return;
    case "pl-delete-no": state.plDelete = false; render(); return;
    case "pl-delete-yes": state.playlists = state.playlists.filter((p) => p.id !== state.playlistId); savePlaylists(); state.plDelete = false; state.view = "favoris"; state.playlistId = null; render(); return;
    case "dir-add": {
      const picked = await api.chooseFolder("");
      if (!picked) return;
      try { state.userDirs = await api.addUserDir(picked); toast(t("Dossier ajouté : lecture de vos sons…")); void loadPerso(); } catch (e) { toast(t("Dossier impossible à ajouter : {e}", { e: errText(e) })); }
      render(); return;
    }
    case "dir-remove": {
      const dir = el.closest<HTMLElement>("[data-dir]")!.dataset.dir!;
      try { state.userDirs = await api.removeUserDir(dir); void loadPerso(); } catch (e) { toast(t("Impossible : {e}", { e: errText(e) })); }
      render(); return;
    }
    case "dir-rescan": toast(t("Mise à jour de vos sons…")); void loadPerso(); return;
    case "reveal": {
      const s = byId(state.selId);
      if (s) { try { await api.revealInFolder(await localPath(s)); } catch { toast(t("Impossible d'ouvrir le dossier.")); } }
      return;
    }
    case "open-folder":
      try { await api.openFolder(state.libDir); } catch { toast(t("Le dossier sera créé au premier son utilisé.")); }
      return;
    case "integrations": state.intOpen = !state.intOpen; render(); return;
    case "install-premiere": await installPremiere(); return;
    case "install-resolve": await installResolve(); return;
    case "theme": state.theme = isDark() ? "clair" : "sombre"; store.set("onde.theme", state.theme); render(); return;
    case "compact": state.compact = !state.compact; store.set("onde.compact", state.compact); await api.setCompactWindow(state.compact); render(); return;
    case "win-min": return api.windowAction("minimize");
    case "win-max": return api.windowAction("maximize");
    case "win-close": return api.windowAction("close");
    case "update-later": state.update = null; render(); return;
    case "update-install": if (state.update) { toast(t("Téléchargement de la mise à jour…")); await state.update.install(); } return;
    case "cleanup-set": {
      const days = Number(el.closest<HTMLElement>("[data-value]")!.dataset.value);
      try { await api.setCleanupDays(days); state.cleanup = await api.cleanupInfo(); } catch { toast(t("Réglage impossible à enregistrer.")); }
      render(); return;
    }
    case "settings": state.screen = state.screen === "reglages" ? "biblio" : "reglages"; if (state.screen === "reglages") void api.cleanupInfo().then((c) => { state.cleanup = c; if (state.screen === "reglages") render(); }).catch(() => {}); if (state.compact) { state.compact = false; store.set("onde.compact", false); await api.setCompactWindow(false); } render(); return;
    case "back": state.screen = "biblio"; render(); return;
    case "feedback": state.feedback = { kind: "bug", message: "", email: store.get("onde.email", ""), sending: false, error: "" }; state.intOpen = false; render(); document.getElementById("fb-msg")?.focus(); return;
    case "open-site": try { await api.openUrl("https://ondesound.com"); } catch { toast(t("Impossible d'ouvrir le site.")); } return;
    case "news-close": if (el.closest(".modal") && !el.closest('button[data-act="news-close"]')) return; state.news = null; render(); return;
    case "offline-toggle": state.onlyLocal = !state.onlyLocal; render(); return;
    case "launch-set": state.launchAnim = el.closest<HTMLElement>("[data-value]")!.dataset.value as LaunchMode; store.set("onde.animDemarrage", state.launchAnim); render(); return;
    case "replay-accueil": {
      if (!introWanted()) { await openAccueil(); return; }
      await playIntro(openAccueil().then(nextFrame));
      return;
    }
    case "more": state.limit += 300; render(); return;
    case "source": {
      const s = byId(state.selId);
      if (s?.sourceUrl) { try { await api.openUrl(s.sourceUrl); } catch { toast(t("Impossible d'ouvrir la page.")); } }
      return;
    }
    case "goto": document.getElementById(el.closest<HTMLElement>("[data-goto]")!.dataset.goto!)?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    case "lang-set": {
      setLangPref(el.closest<HTMLElement>("[data-value]")!.dataset.value as LangPref);
      sortSounds(state.catalog); sortSounds(state.perso); state.catalog = [...state.catalog]; state.perso = [...state.perso];
      document.documentElement.lang = getLang();
      render(); return;
    }
    case "theme-set": state.theme = el.closest<HTMLElement>("[data-value]")!.dataset.value as Theme; store.set("onde.theme", state.theme); render(); return;
    case "choose-folder": {
      const picked = await api.chooseFolder(state.libDir);
      if (picked) await changeLibrary(picked);
      return;
    }
    case "reset-folder": await changeLibrary(null); return;
    case "check-update": {
      toast(t("Recherche d'une mise à jour…"));
      const u = await api.checkForUpdate();
      if (u) { state.update = u; render(); } else toast(t("Aucune mise à jour disponible pour l'instant."));
      return;
    }
  }
  if (rowEl && !dragging) { state.selId = rowEl.dataset.id!; render(); }
});

root.addEventListener("dblclick", (e) => {
  const rowEl = (e.target as HTMLElement).closest<HTMLElement>(".row");
  if (rowEl) void togglePlay(rowEl.dataset.id!);
});

root.addEventListener("input", (e) => {
  const el = e.target as HTMLInputElement;
  if (el.id === "q") { state.query = el.value; state.limit = 150; render(); }
  if (el.id === "pl-name") { const p = playlistOf(state.playlistId); if (p) { p.name = el.value; savePlaylists(); const nav = document.querySelector(`.side [data-pl="${p.id}"] span`); if (nav) nav.lastChild!.textContent = el.value; } }
  if (el.id?.startsWith("cb-")) contrib.input(el);
  if (state.feedback && el.id === "fb-msg") state.feedback.message = el.value;
  if (state.feedback && el.id === "fb-mail") { state.feedback.email = el.value; store.set("onde.email", el.value); }
});

root.addEventListener("change", (e) => {
  const el = e.target as HTMLSelectElement;
  if (el.id === "cat-select") { state.category = el.value || null; state.limit = 150; render(); }
});

// ---------- Playlists ----------
function newPlaylist(): Playlist {
  let n = state.playlists.length + 1;
  const name = (k: number) => t("Biblio n°{k}", { k: String(k).padStart(2, "0") });
  while (state.playlists.some((p) => p.name === name(n))) n++;
  const p: Playlist = { id: `pl-${Date.now().toString(36)}`, name: name(n), ids: [] };
  state.playlists.push(p);
  savePlaylists();
  return p;
}

function openPlaylist(id: string): void {
  if (state.screen === "contrib") contrib.stop();
  state.screen = "biblio";
  state.view = "playlist";
  state.playlistId = id;
  state.category = null;
  state.plDelete = false;
  state.limit = 150;
  render();
}

// ---------- Sons personnels ----------
let persoRun = 0;
/** Lit les dossiers personnels, puis analyse les nouveaux sons par petits paquets. */
async function loadPerso(): Promise<void> {
  const run = ++persoRun;
  try {
    state.userDirs = await api.getUserDirs();
    const found = await api.scanUserSounds();
    if (run !== persoRun) return;
    state.perso = sortSounds(found.map(toSound));
    const todo = found.filter((u) => u.peaks === null);
    state.analyzing = todo.length;
    render();
    for (let i = 0; i < todo.length; i += 12) {
      const done = await api.analyzeUserSounds(todo.slice(i, i + 12));
      if (run !== persoRun) return;
      const byPath = new Map(done.map((u) => [u.path, toSound(u)]));
      state.perso = state.perso.map((x) => (x.local && byPath.get(x.local)) || x);
      state.analyzing = Math.max(0, todo.length - i - 12);
      render();
    }
  } catch (e) {
    console.error("Sons personnels :", e);
  }
  state.analyzing = 0;
  render();
}

function toggleFav(target: string | null = state.selId): void {
  const id = target;
  if (!id) return;
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  store.set("onde.favoris", [...state.favs]);
  render();
}

// Raccourcis : Ctrl K chercher · Espace écouter · ↑ ↓ naviguer · F favori · Échap fermer
window.addEventListener("keydown", (e) => {
  if (state.news) {
    if (e.key === "Escape" || e.key === "Enter") { e.preventDefault(); state.news = null; render(); }
    return;
  }
  if (state.feedback) {
    if (e.key === "Escape") { state.feedback = null; render(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void feedbackAction("fb-send", document.body);
    return;
  }
  if (state.screen === "accueil") {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); void accueilAction("ob-next", document.body); }
    return;
  }
  if ((e.target as HTMLElement).id === "pl-name") { if (e.key === "Enter" || e.key === "Escape") (e.target as HTMLElement).blur(); return; }
  const typing = ["INPUT", "SELECT"].includes((e.target as HTMLElement).tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("q")?.focus(); return; }
  if (e.key === "Escape") {
    if (state.intOpen) { state.intOpen = false; render(); }
    else if (state.screen === "reglages") { state.screen = "biblio"; render(); }
    else (document.activeElement as HTMLElement)?.blur();
    return;
  }
  if (state.screen === "reglages") return;
  if (state.screen === "contrib") { if (e.key === "Escape") { contrib.stop(); state.screen = "biblio"; render(); } return; }
  if (typing && !["ArrowDown", "ArrowUp", "Enter"].includes(e.key)) return;
  const list = visibleSounds();
  const i = list.findIndex((s) => s.id === state.selId);
  if (e.key === "ArrowDown" || e.key === "ArrowUp") {
    e.preventDefault();
    const next = list[Math.max(0, Math.min(list.length - 1, i + (e.key === "ArrowDown" ? 1 : -1)))];
    if (next) { state.selId = next.id; render(); document.querySelector(`.row[data-id="${next.id}"]`)?.scrollIntoView({ block: "nearest" }); }
  } else if (e.key === " " || e.key === "Enter") {
    e.preventDefault();
    if (state.selId) void togglePlay(state.selId);
  } else if (e.key.toLowerCase() === "f" && !typing) {
    toggleFav();
  }
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => { if (state.theme === "systeme") render(); });

// ---------- Démarrage ----------
const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

async function loadLibrary(): Promise<boolean> {
  try {
    let cat: Catalog;
    [cat, state.libDir, state.version] = await Promise.all([api.getCatalog(), api.libraryDir(), api.appVersion()]);
    state.catalog = cat.sounds;
    state.cdn = cat.cdn;
    state.origin = cat.origin;
    state.premiere = await api.premiereStatus().catch(() => null);
    state.resolve = await api.resolveStatus().catch(() => null);
    state.local = new Set(await api.localSounds().catch(() => []));
    state.offline = cat.origin === "cache" || !navigator.onLine;
    if (state.offline) toast(`${t("Hors ligne")} : ${tn(state.local.size, "{n} son disponible sur cet ordinateur", "{n} sons disponibles sur cet ordinateur")}.`);
  } catch (e) {
    root.innerHTML = `<p class="empty" style="padding:40px">${t("Impossible de charger la bibliothèque : {e}", { e: esc(errText(e)) })}</p>`;
    return false;
  }
  sortSounds(state.catalog);
  state.selId = state.catalog[0]?.id ?? null;
  return true;
}

async function start(): Promise<void> {
  document.documentElement.lang = getLang();
  const firstRun = !store.get("onde.accueil", 0);
  document.documentElement.dataset.theme = isDark() ? "sombre" : "clair";
  // Rouvre dans le mode où l'application a été fermée (compact ou grande fenêtre)
  if (!firstRun && store.get("onde.compact", false)) {
    state.compact = true;
    document.body.classList.add("compact");
    await api.setCompactWindow(true).catch(() => {});
  }

  if (firstRun && introWanted()) {
    // Premier lancement : l'animation démarre tout de suite, la bibliothèque charge en parallèle.
    let ok = true;
    const ready = loadLibrary().then(async (loaded) => { ok = loaded; if (loaded) await openAccueil(); await nextFrame(); });
    const intro = playIntro(ready);
    await nextFrame();
    void api.showWindow();
    await intro;
    if (!ok) return;
  } else if (!firstRun && launchWanted(state.launchAnim)) {
    // Lancements suivants : petite animation du logo pendant que la bibliothèque charge.
    let ok = true;
    const ready = loadLibrary().then(async (loaded) => { ok = loaded; if (loaded) render(); await nextFrame(); });
    const anim = playLaunch(ready, state.launchAnim);
    await nextFrame();
    void api.showWindow();
    await anim;
    if (!ok) return;
  } else {
    const loaded = await loadLibrary();
    if (loaded) { if (firstRun) await openAccueil(); else render(); }
    await nextFrame();
    void api.showWindow();
    if (!loaded) return;
  }
  // Première ouverture d'une nouvelle version : on montre ses nouveautés (pas au tout premier lancement)
  const seen = store.get<string>("onde.versionVue", "");
  if ((seen || !firstRun) && seen !== state.version) state.news = notesHtml(state.version);
  store.set("onde.versionVue", state.version);
  if (state.news) render();
  void loadPerso();
  void api.contributionsOpen().then((open) => { state.contribOpen = open; if (open) render(); });
  state.update = await api.checkForUpdate();
  if (state.update) render();
}

void start();
