import "./styles.css";
import * as api from "./api";
import { formatDuration, normalize, search } from "./search";
import type { Catalog, Sound, Theme, UpdateInfo, View } from "./types";
import { accueilScreen, STEPS, type Accueil } from "./bienvenue";
import { introWanted, playIntro } from "./intro";

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
  screen: "biblio" as "biblio" | "reglages" | "accueil",
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

// ---------- Petites aides ----------
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const byId = (id: string | null) => state.catalog.find((s) => s.id === id) ?? null;

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
  gear: `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M4.2 4.2l2.1 2.1M17.7 17.7l2.1 2.1M2 12h3M19 12h3M4.2 19.8l2.1-2.1M17.7 6.3l2.1-2.1"/></svg>`,
  chat: `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M4 4h16v12H9l-5 4z"/></svg>`,
  logo: `<svg width="20" height="20" viewBox="0 0 120 120" aria-hidden="true"><rect width="120" height="120" fill="#002FA7"/><rect x="12" y="34" width="96" height="58" fill="#FFFFFF"/><g fill="#002FA7"><rect x="22" y="50" width="12" height="26"/><rect x="40" y="42" width="12" height="42"/><rect x="76" y="46" width="12" height="34"/></g><polygon points="50,4 78,4 78,20 64,32 50,20" fill="#E2231A"/><rect x="58" y="26" width="12" height="84" fill="#E2231A"/></svg>`,
  word: `<svg width="52" height="20" viewBox="0 0 256 100" role="img" aria-label="Onde"><g fill="none" stroke="currentColor" stroke-width="13"><circle cx="28" cy="52" r="21.5"/><path d="M72.5 80V24M72.5 52a21.5 21.5 0 0 1 43 0V80"/><circle cx="160" cy="52" r="21.5"/><path d="M247.5 52A21.5 21.5 0 1 0 242.5 65.8"/><path d="M204.5 52H247.5"/></g><polygon points="169,0 194,0 194,10 181.5,20 169,10" fill="#E2231A"/><rect x="175" y="14" width="13" height="66" fill="#E2231A"/></svg>`,
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
  let list = state.catalog;
  if (state.view === "favoris") list = list.filter((s) => state.favs.has(s.id));
  if (state.view === "recents") list = state.recents.map((id) => byId(id)).filter((s): s is Sound => !!s);
  if (state.category) list = list.filter((s) => s.category === state.category);
  return search(list, state.query);
}

// ---------- Rendu ----------
function render(): void {
  const resolved = state.theme === "systeme" ? (matchMedia("(prefers-color-scheme: dark)").matches ? "sombre" : "clair") : state.theme;
  document.documentElement.dataset.theme = resolved;
  document.body.classList.toggle("compact", state.compact);

  const list = visibleSounds();
  if (!list.some((s) => s.id === state.selId)) state.selId = list[0]?.id ?? state.selId;
  const cur = byId(state.selId);
  const focused = document.activeElement?.id;

  if (state.screen === "accueil") {
    root.innerHTML = accueilScreen(state.accueil, state.theme, ICON.word, winButtons());
    return;
  }

  root.innerHTML = `
    ${titlebar()}
    ${state.update ? updateBanner(state.update) : "<div></div>"}
    ${state.screen === "reglages" ? settingsScreen() : `
    <div class="body">
      ${sidebar()}
      ${mainList(list)}
      ${cur ? detail(cur) : `<aside class="detail"><p class="hint">Sélectionnez un son.</p></aside>`}
    </div>
    ${cur ? minibar(cur) : ""}`}
    ${state.feedback ? feedbackDialog() : ""}`;

  if (state.feedback && focused?.startsWith("fb-")) {
    const el = document.getElementById(focused) as HTMLInputElement | HTMLTextAreaElement | null;
    el?.focus();
    if (el) el.setSelectionRange(el.value.length, el.value.length);
  }
  if (focused === "q") {
    const q = document.getElementById("q") as HTMLInputElement;
    q.focus();
    q.setSelectionRange(q.value.length, q.value.length);
  }
  syncProgress();
}

async function changeLibrary(path: string | null): Promise<void> {
  try {
    state.libDir = await api.setLibraryDir(path);
    state.paths.clear(); // les prochains sons iront dans le nouveau dossier
    toast(`Les prochains sons seront rangés dans ${state.libDir}`);
  } catch (e) {
    toast(`Dossier impossible à utiliser : ${e instanceof Error ? e.message : e}`);
  }
  render();
}

function settingsScreen(): string {
  const sections: [string, string][] = [["r-app", "Apparence"], ["r-lib", "Dossier des sons"], ["r-keys", "Raccourcis"], ["r-upd", "Mises à jour"], ["r-about", "À propos"]];
  const themes: [Theme, string][] = [["clair", "Clair"], ["sombre", "Sombre"], ["systeme", "Comme Windows"]];
  const keys: [string, string][] = [["Rechercher", "CTRL K"], ["Écouter / pause", "ESPACE"], ["Son suivant / précédent", "↓ ↑"], ["Ajouter aux favoris", "F"], ["Fermer / revenir", "ÉCHAP"], ["Glisser vers la timeline", "SOURIS"]];
  return `<div class="settings">
    <nav class="side" aria-label="Sections des réglages">
      <div class="nav">
        <button data-act="back"><span>← Bibliothèque</span></button>
        <p class="eyebrow" style="margin-top:16px">Réglages</p>
        ${sections.map(([id, label]) => `<button data-act="goto" data-goto="${id}"><span>${label}</span></button>`).join("")}
      </div>
    </nav>
    <main class="set-main">
      <h1>Réglages</h1>

      <section id="r-app" aria-labelledby="h-app">
        <h2 id="h-app" class="eyebrow">Apparence</h2>
        <div class="set-row">
          <div><b>Mode</b><span>Le mode sombre est plus doux en salle de montage.</span></div>
          <div class="segmented" role="radiogroup" aria-label="Mode d'affichage">
            ${themes.map(([v, label]) => `<button role="radio" data-act="theme-set" data-value="${v}" aria-checked="${state.theme === v}">${label}</button>`).join("")}
          </div>
        </div>
      </section>

      <section id="r-lib" aria-labelledby="h-lib">
        <h2 id="h-lib" class="eyebrow">Dossier des sons</h2>
        <div class="set-row">
          <div><b>Emplacement</b><span class="mono path">${esc(state.libDir)}</span></div>
          <div class="btns">
            <button class="secondary" data-act="open-folder">Ouvrir</button>
            <button class="secondary strong" data-act="choose-folder">Changer…</button>
          </div>
        </div>
        <div class="set-row">
          <div><b>Revenir au dossier par défaut</b><span>Documents\\Onde. Les sons déjà utilisés restent à leur place : vos projets de montage les retrouvent toujours.</span></div>
          <button class="secondary" data-act="reset-folder">Rétablir</button>
        </div>
      </section>

      <section id="r-keys" aria-labelledby="h-keys">
        <h2 id="h-keys" class="eyebrow">Raccourcis</h2>
        <div class="keys">${keys.map(([label, k]) => `<div><span>${label}</span><span class="kbd">${k}</span></div>`).join("")}</div>
      </section>

      <section id="r-upd" aria-labelledby="h-upd">
        <h2 id="h-upd" class="eyebrow">Mises à jour</h2>
        <div class="set-row">
          <div><b>Onde ${esc(state.version)} · bêta</b><span>Chaque mise à jour est signée par l'équipe Onde. Les nouveaux sons arriveront sans mise à jour de l'application.</span></div>
          <button class="secondary strong" data-act="check-update">Rechercher une mise à jour</button>
        </div>
      </section>

      <section id="r-about" class="about" aria-labelledby="h-about">
        <div>
          <h2 id="h-about">Onde ${esc(state.version)} · open-source</h2>
          <span>Gratuit, et ça s'entend. Code publié sous licence AGPL-3.0.</span>
        </div>
        <div class="btns"><button class="secondary" data-act="replay-accueil">Revoir l'accueil</button><span class="badge">SOUTIEN BIENTÔT</span></div>
      </section>
    </main>
  </div>`;
}

function titlebar(): string {
  return `
  <header class="titlebar">
    <div class="brand" data-tauri-drag-region>${ICON.logo}${ICON.word}<span class="tag">BÊTA ${esc(state.version)}</span></div>
    <div class="tb-actions">
      <button class="tb-btn tb-hide" data-act="integrations" aria-haspopup="true" aria-expanded="${state.intOpen}">${ICON.plug}Intégrations</button>
      <button class="tb-btn tb-hide" data-act="theme" aria-label="Changer de mode">${state.theme === "sombre" ? "Mode clair" : "Mode sombre"}</button>
      <button class="tb-btn" data-act="compact" aria-pressed="${state.compact}">${state.compact ? "Grande fenêtre" : "Mode compact"}</button>
      <button class="tb-btn tb-hide" data-act="feedback" aria-haspopup="dialog">${ICON.chat}Envoyer un retour</button>
      <button class="tb-btn tb-icon" data-act="settings" aria-pressed="${state.screen === "reglages"}" aria-label="Réglages" title="Réglages">${ICON.gear}</button>
      ${winButtons()}
    </div>
    ${state.intOpen ? integrations() : ""}
  </header>`;
}

function winButtons(): string {
  return `<div class="win">
        <button data-act="win-min" aria-label="Réduire"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 5h10" stroke="currentColor"/></svg></button>
        <button data-act="win-max" aria-label="Agrandir"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><rect x="0.5" y="0.5" width="9" height="9" fill="none" stroke="currentColor"/></svg></button>
        <button data-act="win-close" class="close" aria-label="Fermer"><svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M0 0l10 10M10 0L0 10" stroke="currentColor"/></svg></button>
      </div>`;
}

// ---------- Envoyer un retour ----------
function feedbackDialog(): string {
  const f = state.feedback!;
  const kinds: [api.FeedbackKind, string][] = [["bug", "Un bug"], ["idee", "Une idée"], ["autre", "Autre chose"]];
  const ph = f.kind === "bug" ? "Ce que vous faisiez, ce qui s'est passé, ce que vous attendiez…" : f.kind === "idee" ? "Ce qui vous ferait gagner du temps au montage…" : "Votre message…";
  return `<div class="modal-bg" data-act="fb-close-bg">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="fb-title">
      <header><h2 id="fb-title">Envoyer un retour</h2><p>Onde est en bêta : chaque message est lu, et c'est comme ça qu'il s'améliore.</p></header>
      <div class="segmented" role="radiogroup" aria-label="Type de retour">
        ${kinds.map(([v, l]) => `<button role="radio" data-act="fb-kind" data-value="${v}" aria-checked="${f.kind === v}">${l}</button>`).join("")}
      </div>
      <label class="fld"><span>Message</span><textarea id="fb-msg" rows="6" maxlength="4000" placeholder="${ph}">${esc(f.message)}</textarea></label>
      <label class="fld"><span>Votre e-mail <em>· facultatif, pour qu'on puisse vous répondre</em></span><input id="fb-mail" type="email" value="${esc(f.email)}" placeholder="vous@exemple.fr" autocomplete="email" /></label>
      <p class="fine">La version d'Onde (${esc(state.version)}) et le système sont ajoutés automatiquement. Rien d'autre n'est envoyé.</p>
      ${f.error ? `<p class="fb-err" role="alert">${esc(f.error)} <button class="link-btn" data-act="fb-mail">Écrire par e-mail à la place</button></p>` : ""}
      <footer>
        <button class="secondary" data-act="fb-close">Annuler</button>
        <button class="solid-btn" data-act="fb-send" ${f.sending ? "disabled" : ""}>${f.sending ? "Envoi…" : "Envoyer"}</button>
      </footer>
    </div>
  </div>`;
}

async function feedbackAction(act: string, t: HTMLElement): Promise<void> {
  const f = state.feedback;
  if (!f) return;
  switch (act) {
    case "fb-close-bg": if (t.classList.contains("modal-bg")) { state.feedback = null; break; } return;
    case "fb-close": state.feedback = null; break;
    case "fb-kind": f.kind = t.closest<HTMLElement>("[data-value]")!.dataset.value as api.FeedbackKind; break;
    case "fb-mail": {
      const body = `${f.message}\n\n—\nOnde ${state.version}`;
      try { await api.openUrl(`mailto:contact.ondesound@gmail.com?subject=${encodeURIComponent("Retour sur Onde")}&body=${encodeURIComponent(body)}`); } catch { toast("Écrivez-nous à contact.ondesound@gmail.com"); }
      return;
    }
    case "fb-send": {
      if (f.message.trim().length < 3) { f.error = "Écrivez quelques mots avant d'envoyer."; break; }
      f.sending = true; f.error = ""; render();
      try {
        await api.sendFeedback(f.kind, f.message.trim(), f.email.trim());
        state.feedback = null;
        render();
        toast("Merci ! Votre retour est bien arrivé.");
        return;
      } catch (e) {
        f.sending = false;
        f.error = e instanceof Error ? e.message : String(e);
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
    catch (e) { toast(`Dossier impossible à utiliser : ${e instanceof Error ? e.message : e}`); }
  }
  store.set("onde.accueil", 1);
  state.screen = "biblio";
  state.query = query;
  state.view = "tout";
  state.category = null;
  render();
  if (query) {
    const first = visibleSounds()[0];
    if (first) state.selId = first.id;
    render();
  } else document.getElementById("q")?.focus();
}

async function accueilAction(act: string, t: HTMLElement): Promise<void> {
  const a = state.accueil;
  switch (act) {
    case "ob-theme": state.theme = t.closest<HTMLElement>("[data-value]")!.dataset.value as Theme; store.set("onde.theme", state.theme); break;
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
    case "ob-try": return finishAccueil(t.closest<HTMLElement>("[data-q]")!.dataset.q!);
  }
  render();
  document.querySelector<HTMLElement>(act === "ob-next" || act === "ob-back" ? ".ob-next" : `[data-act="${act}"]`)?.focus();
}

function integrations(): string {
  const rows = [
    ["Pr", "Premiere Pro", "Panneau Onde intégré", "BIENTÔT", false],
    ["Dr", "DaVinci Resolve Studio", "Plugin intégré · version Studio", "BIENTÔT", false],
    ["Ae", "After Effects", "Panneau Onde", "BIENTÔT", false],
    ["Fc", "Final Cut Pro", "Avec la version macOS", "BIENTÔT", false],
    ["⇄", "Tous les logiciels", "Glissez un son depuis Onde vers votre timeline", "ACTIF", true],
  ] as const;
  return `<div class="popover" role="dialog" aria-label="Intégrations logicielles">
    <header><h2>Intégrations logicielles</h2><p>Utilisez Onde directement dans votre logiciel de montage.</p></header>
    ${rows.map(([ini, name, info, badge, on]) => `<div class="int"><span class="ini" aria-hidden="true">${ini}</span><div class="meta"><b>${name}</b><span>${info}</span></div><span class="badge ${on ? "on" : ""}">${badge}</span></div>`).join("")}
  </div>`;
}

function updateBanner(u: UpdateInfo): string {
  return `<div class="update" role="status">
    <span class="tagline">MISE À JOUR</span><b>Onde ${esc(u.version)} est prête.</b>
    <span>${esc(u.notes.split("\n")[0] ?? "")}</span><span class="spacer"></span>
    <button data-act="update-later">Plus tard</button>
    <button class="solid" data-act="update-install">Installer et redémarrer</button>
  </div>`;
}

function sidebar(): string {
  const views: [View, string, number][] = [
    ["tout", "Bibliothèque", state.catalog.length],
    ["favoris", "Favoris", state.favs.size],
    ["recents", "Récents", state.recents.length],
  ];
  const cats = new Map<string, { code: string; n: number }>();
  for (const s of state.catalog) {
    const c = cats.get(s.category) ?? { code: s.code, n: 0 };
    c.n++;
    cats.set(s.category, c);
  }
  return `<nav class="side" aria-label="Navigation">
    <div class="nav">${views.map(([v, label, n]) => `<button data-view="${v}" aria-current="${state.view === v && !state.category}"><span>${label}</span><span class="mono">${n}</span></button>`).join("")}</div>
    <div class="nav"><p class="eyebrow">Catégories UCS</p>
      ${[...cats].sort((a, b) => a[0].localeCompare(b[0], "fr")).map(([cat, { code }]) => `<button data-cat="${esc(cat)}" aria-current="${state.category === cat}"><span>${esc(cat)}</span><span class="mono">${code}</span></button>`).join("")}
    </div>
    <div class="folder"><span class="eyebrow">Bibliothèque · ${state.origin === "en ligne" ? "en ligne" : state.origin === "cache" ? "hors ligne" : "sons de test"}</span><span class="path" style="margin-bottom:8px">${state.catalog.length} sons</span><span class="eyebrow">Dossier local</span><span class="path">${esc(state.libDir)}</span><button class="link-btn" data-act="open-folder">Ouvrir le dossier</button></div>
  </nav>`;
}

function mainList(list: Sound[]): string {
  const counts = new Map<string, number>();
  for (const s of state.catalog) counts.set(s.category, (counts.get(s.category) ?? 0) + 1);
  const filters = [null, ...[...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c)].slice(0, 8);
  return `<main class="main">
    <div class="searchbar">${ICON.search}
      <label for="q" class="sr">Rechercher un son</label>
      <input id="q" type="search" value="${esc(state.query)}" placeholder="Décrivez un son : « porte qui grince », « whoosh »…" autocomplete="off" spellcheck="false" />
      <span class="mono" style="color:var(--muted);border:1px solid var(--line);padding:3px 6px">CTRL K</span>
    </div>
    <div class="chips">
      ${filters.map((c) => `<button class="chip" data-cat="${c ?? ""}" aria-pressed="${state.category === c}">${c ? esc(c) : "Tout"}</button>`).join("")}
      <span class="count mono">${list.length} ${list.length > 1 ? "SONS" : "SON"}</span>
    </div>
    <div class="list" role="listbox" aria-label="Résultats">
      ${list.length ? list.slice(0, state.limit).map(row).join("") : `<p class="empty">${emptyText()}</p>`}
      ${list.length > state.limit ? `<button class="more" data-act="more">Afficher plus (${list.length - state.limit} autres sons)</button>` : ""}
    </div>
  </main>`;
}

function emptyText(): string {
  if (state.view === "favoris" && !state.favs.size) return "Aucun favori pour l'instant. Touchez l'étoile d'un son, ou la touche F.";
  if (state.view === "recents" && !state.recents.length) return "Les sons que vous écoutez apparaîtront ici.";
  return "Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».";
}

function row(s: Sound): string {
  const sel = s.id === state.selId;
  const playing = s.id === state.playingId && !audio.paused;
  return `<div class="row" role="option" data-id="${s.id}" aria-selected="${sel}" title="Glissez vers votre timeline">
    <button class="play ${playing ? "on" : ""}" data-act="play" aria-label="${playing ? "Pause" : "Écouter"} ${esc(s.title)}">${playing ? ICON.pause : ICON.play}</button>
    <div class="t"><b>${esc(s.title)}</b><span>${s.tags.map(esc).join(" · ")}</span></div>
    <span class="code">${s.code}</span>
    <div class="wave">${waveSvg(s.peaks, 60)}</div>
    <span class="dur">${formatDuration(s.durationMs)}</span>
    <span class="grip" aria-hidden="true">${ICON.grip}</span>
  </div>`;
}

function detail(s: Sound): string {
  const playing = s.id === state.playingId && !audio.paused;
  const fav = state.favs.has(s.id);
  return `<aside class="detail" aria-label="Son sélectionné">
    <div style="display:grid;gap:6px"><span class="eyebrow">${s.code} · ${formatDuration(s.durationMs)}</span><h2>${esc(s.title)}</h2></div>
    <div class="bigwave" data-drag="${s.id}" title="Glissez la forme d'onde vers votre timeline">
      ${waveSvg(s.peaks, 110, "base")}${waveSvg(s.peaks, 110, "played")}<span class="head" hidden></span>
    </div>
    <div class="transport">
      <button class="play big ${playing ? "on" : ""}" data-act="play-sel" aria-label="${playing ? "Pause" : "Écouter"}">${playing ? ICON.pause : ICON.play}</button>
      <span class="mono" id="time">00:00.00 / ${formatDuration(s.durationMs)}</span>
      <button class="sq-btn" data-act="fav" aria-pressed="${fav}" aria-label="${fav ? "Retirer des favoris" : "Ajouter aux favoris"}">${fav ? ICON.starOn : ICON.star}</button>
    </div>
    ${s.description ? `<p class="desc">${esc(s.description)}</p>` : ""}
    <dl class="facts">
      <div><dt>Format</dt><dd>${esc(s.format)}</dd></div>
      <div><dt>Catégorie</dt><dd>${esc(s.category)}</dd></div>
      <div><dt>Licence</dt><dd>${s.license === "CC0" ? "CC0 · sans crédit obligatoire" : esc(s.license)}</dd></div>
      <div><dt>Code UCS</dt><dd>${s.code}</dd></div>
    </dl>
    <div class="tags">${s.tags.map((t) => `<span>${esc(t)}</span>`).join("")}</div>
    ${s.credit ? `<p class="credit">Son : <button class="link-btn" data-act="source" title="Ouvrir la page du son">${esc(s.credit)} ↗</button></p>` : ""}
    <div class="actions">
      <button class="primary" data-drag="${s.id}">Glissez-moi dans votre timeline<span aria-hidden="true">⤓</span></button>
      <button class="secondary" data-act="reveal">Afficher dans le dossier</button>
      <p class="hint">Astuce : vous pouvez aussi attraper n'importe quelle ligne de la liste.</p>
    </div>
  </aside>`;
}

function minibar(s: Sound): string {
  const playing = s.id === state.playingId && !audio.paused;
  return `<div class="minibar">
    <div class="info"><button class="play big ${playing ? "on" : ""}" data-act="play-sel" aria-label="${playing ? "Pause" : "Écouter"}">${playing ? ICON.pause : ICON.play}</button>
      <div><b>${esc(s.title)}</b><span class="mono" style="color:var(--muted)">${s.code} · ${formatDuration(s.durationMs)}</span></div></div>
    <button class="primary" data-drag="${s.id}">Glissez dans la timeline<span aria-hidden="true">⤓</span></button>
  </div>`;
}

// ---------- Lecture ----------
const inflight = new Map<string, Promise<string>>();

async function localPath(s: Sound): Promise<string> {
  const known = state.paths.get(s.id);
  if (known) return known;
  let job = inflight.get(s.id);
  if (!job) {
    job = api.ensureLocal(s.id).then(
      (p) => { if (p) state.paths.set(s.id, p); inflight.delete(s.id); return p; },
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
  try {
    if (state.playingId !== id) {
      if (state.cdn) {
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
    toast(`Lecture impossible : ${e instanceof Error ? e.message : e}`);
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
  dragging = true;
  try {
    const ready = state.paths.has(s.id);
    if (!ready) toast("Téléchargement du son…");
    const path = await localPath(s);
    if (!ready && !mouseDown) { toast("Son prêt : attrapez-le à nouveau pour le glisser."); return; }
    await api.dragOut([path]);
  } catch (err) {
    toast(api.inTauri ? `Glisser impossible : ${err instanceof Error ? err.message : err}` : "Le glisser-déposer vers un logiciel fonctionne dans l'application Onde, pas dans le navigateur.");
  } finally {
    dragging = false;
  }
});

window.addEventListener("pointerup", () => { pending = null; mouseDown = false; });

// ---------- Actions ----------
root.addEventListener("click", async (e) => {
  const t = e.target as HTMLElement;
  const rowEl = t.closest<HTMLElement>(".row");
  const act = t.closest<HTMLElement>("[data-act]")?.dataset.act;
  const view = t.closest<HTMLElement>("[data-view]")?.dataset.view as View | undefined;
  const catBtn = t.closest<HTMLElement>("[data-cat]");

  if (state.intOpen && !t.closest(".popover") && act !== "integrations") { state.intOpen = false; render(); }
  if (view) { state.view = view; state.category = null; state.limit = 150; render(); return; }
  if (catBtn) { state.category = catBtn.dataset.cat || null; state.limit = 150; render(); return; }

  if (act?.startsWith("ob-")) { await accueilAction(act, t); return; }
  if (act?.startsWith("fb-")) { await feedbackAction(act, t); return; }
  if (state.feedback) return;

  switch (act) {
    case "play": if (rowEl) await togglePlay(rowEl.dataset.id!); return;
    case "play-sel": if (state.selId) await togglePlay(state.selId); return;
    case "fav": toggleFav(); return;
    case "reveal": {
      const s = byId(state.selId);
      if (s) { try { await api.revealInFolder(await localPath(s)); } catch { toast("Impossible d'ouvrir le dossier."); } }
      return;
    }
    case "open-folder":
      try { await api.openFolder(state.libDir); } catch { toast("Le dossier sera créé au premier son utilisé."); }
      return;
    case "integrations": state.intOpen = !state.intOpen; render(); return;
    case "theme": state.theme = state.theme === "sombre" ? "clair" : "sombre"; store.set("onde.theme", state.theme); render(); return;
    case "compact": state.compact = !state.compact; await api.setCompactWindow(state.compact); render(); return;
    case "win-min": return api.windowAction("minimize");
    case "win-max": return api.windowAction("maximize");
    case "win-close": return api.windowAction("close");
    case "update-later": state.update = null; render(); return;
    case "update-install": if (state.update) { toast("Téléchargement de la mise à jour…"); await state.update.install(); } return;
    case "settings": state.screen = state.screen === "reglages" ? "biblio" : "reglages"; if (state.compact) { state.compact = false; await api.setCompactWindow(false); } render(); return;
    case "back": state.screen = "biblio"; render(); return;
    case "feedback": state.feedback = { kind: "bug", message: "", email: store.get("onde.email", ""), sending: false, error: "" }; state.intOpen = false; render(); document.getElementById("fb-msg")?.focus(); return;
    case "replay-accueil": {
      if (!introWanted()) { await openAccueil(); return; }
      await playIntro(openAccueil().then(nextFrame));
      return;
    }
    case "more": state.limit += 300; render(); return;
    case "source": {
      const s = byId(state.selId);
      if (s?.sourceUrl) { try { await api.openUrl(s.sourceUrl); } catch { toast("Impossible d'ouvrir la page."); } }
      return;
    }
    case "goto": document.getElementById(t.closest<HTMLElement>("[data-goto]")!.dataset.goto!)?.scrollIntoView({ behavior: "smooth", block: "start" }); return;
    case "theme-set": state.theme = t.closest<HTMLElement>("[data-value]")!.dataset.value as Theme; store.set("onde.theme", state.theme); render(); return;
    case "choose-folder": {
      const picked = await api.chooseFolder(state.libDir);
      if (picked) await changeLibrary(picked);
      return;
    }
    case "reset-folder": await changeLibrary(null); return;
    case "check-update": {
      toast("Recherche d'une mise à jour…");
      const u = await api.checkForUpdate();
      if (u) { state.update = u; render(); } else toast("Aucune mise à jour disponible pour l'instant.");
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
  const t = e.target as HTMLInputElement;
  if (t.id === "q") { state.query = t.value; state.limit = 150; render(); }
  if (state.feedback && t.id === "fb-msg") state.feedback.message = t.value;
  if (state.feedback && t.id === "fb-mail") { state.feedback.email = t.value; store.set("onde.email", t.value); }
});

function toggleFav(): void {
  const id = state.selId;
  if (!id) return;
  if (state.favs.has(id)) state.favs.delete(id); else state.favs.add(id);
  store.set("onde.favoris", [...state.favs]);
  render();
}

// Raccourcis : Ctrl K chercher · Espace écouter · ↑ ↓ naviguer · F favori · Échap fermer
window.addEventListener("keydown", (e) => {
  if (state.feedback) {
    if (e.key === "Escape") { state.feedback = null; render(); }
    else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void feedbackAction("fb-send", document.body);
    return;
  }
  if (state.screen === "accueil") {
    if (e.key === "Enter" && (e.target as HTMLElement).tagName !== "BUTTON") { e.preventDefault(); void accueilAction("ob-next", document.body); }
    return;
  }
  const typing = (e.target as HTMLElement).tagName === "INPUT";
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); document.getElementById("q")?.focus(); return; }
  if (e.key === "Escape") {
    if (state.intOpen) { state.intOpen = false; render(); }
    else if (state.screen === "reglages") { state.screen = "biblio"; render(); }
    else (document.activeElement as HTMLElement)?.blur();
    return;
  }
  if (state.screen === "reglages") return;
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
    if (cat.origin === "cache") toast("Pas de connexion : bibliothèque enregistrée sur ce PC.");
  } catch (e) {
    root.innerHTML = `<p class="empty" style="padding:40px">Impossible de charger la bibliothèque : ${esc(String(e))}</p>`;
    return false;
  }
  state.catalog.sort((a, b) => normalize(a.title).localeCompare(normalize(b.title), "fr"));
  state.selId = state.catalog[0]?.id ?? null;
  return true;
}

async function start(): Promise<void> {
  const firstRun = !store.get("onde.accueil", 0);
  document.documentElement.dataset.theme = state.theme === "sombre" ? "sombre" : "clair";

  if (firstRun && introWanted()) {
    // Premier lancement : l'animation démarre tout de suite, la bibliothèque charge en parallèle.
    let ok = true;
    const ready = loadLibrary().then(async (loaded) => { ok = loaded; if (loaded) await openAccueil(); await nextFrame(); });
    const intro = playIntro(ready);
    await nextFrame();
    void api.showWindow();
    await intro;
    if (!ok) return;
  } else {
    const loaded = await loadLibrary();
    if (loaded) { if (firstRun) await openAccueil(); else render(); }
    await nextFrame();
    void api.showWindow();
    if (!loaded) return;
  }
  state.update = await api.checkForUpdate();
  if (state.update) render();
}

void start();
