// Écran « Mes contributions » : proposer ses propres sons à la bibliothèque.
// Les sons partent en vérification (modération), puis sont publiés crédités au pseudo de l'auteur.
// L'écran n'apparaît que si le serveur a ouvert les contributions.
import * as api from "./api";
import { search } from "./search";
import type { Sound } from "./types";
import { catLabel, collate, errText, getLang, soundTitle, t as tr, tn } from "./i18n";

type Status = "pret" | "envoi" | "erreur";

interface Item {
  path: string;
  name: string;
  ext: string;
  durationMs: number;
  sampleRate: number;
  channels: number;
  peaks: number[];
  title: string;
  code: string;
  tags: string;
  description: string;
  status: Status;
  error: string;
}

interface Sent { id: string; title: string; code: string; date: string }

const store = {
  get<T>(k: string, d: T): T { try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : d; } catch { return d; } },
  set(k: string, v: unknown) { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* sans stockage */ } },
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_MS = 180_000;

export interface ContribHost {
  catalog: () => Sound[];
  toast: (msg: string) => void;
  render: () => void;
  wave: (peaks: number[], bars: number, cls?: string) => string;
  duration: (ms: number) => string;
}

export function createContributions(host: ContribHost) {
  const st = {
    tab: "envoyer" as "envoyer" | "verification" | "publies",
    items: [] as Item[],
    sel: -1,
    pseudo: store.get("onde.contrib.pseudo", ""),
    email: store.get("onde.email", ""),
    cc0: false,
    sending: false,
    sent: store.get<Sent[]>("onde.contrib.envoyes", []),
    playing: -1,
  };
  const buffers = new Map<string, AudioBuffer>();
  let ctx: AudioContext | null = null;
  let src: AudioBufferSourceNode | null = null;

  const categories = () => {
    const m = new Map<string, string>();
    for (const s of host.catalog()) if (!m.has(s.code)) m.set(s.code, s.category);
    return [...m].sort((a, b) => collate(catLabel(a[1]), catLabel(b[1])));
  };
  const publishedIds = () => new Set(host.catalog().map((s) => s.contribution).filter(Boolean) as string[]);

  /** Catégorie suggérée d'après le nom du fichier : la plus fréquente parmi les sons qui lui ressemblent. */
  function guessCode(name: string): string {
    const words = name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\d+/g, " ").split(/\s+/).filter((w) => w.length >= 3);
    const counts = new Map<string, number>();
    for (const w of words) {
      for (const s of search(host.catalog(), w).slice(0, 8)) counts.set(s.code, (counts.get(s.code) ?? 0) + 1);
    }
    return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  }

  function niceTitle(name: string): string {
    const t = name.replace(/\.[^.]+$/, "").replace(/[_\-.]+/g, " ").replace(/\s+/g, " ").trim();
    return t ? t[0].toUpperCase() + t.slice(1) : tr("Sans titre");
  }

  async function analyse(path: string): Promise<Item> {
    const name = path.split(/[\\/]/).pop() ?? path;
    const ext = (name.split(".").pop() ?? "").toLowerCase();
    const item: Item = { path, name, ext, durationMs: 0, sampleRate: 0, channels: 0, peaks: [], title: niceTitle(name), code: guessCode(name), tags: "", description: "", status: "pret", error: "" };
    try {
      const data = await api.readAudio(path);
      ctx ??= new AudioContext();
      const buf = await ctx.decodeAudioData(data.slice(0));
      buffers.set(path, buf);
      item.durationMs = Math.round(buf.duration * 1000);
      item.sampleRate = buf.sampleRate;
      item.channels = buf.numberOfChannels;
      const ch = buf.getChannelData(0), n = 120, step = Math.max(1, Math.floor(ch.length / n));
      const peaks: number[] = [];
      for (let i = 0; i < n; i++) { let m = 0; for (let j = i * step; j < Math.min(ch.length, (i + 1) * step); j += 8) m = Math.max(m, Math.abs(ch[j])); peaks.push(m); }
      const top = Math.max(...peaks, 1e-6);
      item.peaks = peaks.map((p) => Math.round((p / top) * 1000) / 1000);
      if (item.durationMs > MAX_MS) { item.status = "erreur"; item.error = tr("Trop long : 3 minutes au maximum."); }
    } catch (e) {
      item.status = "erreur";
      item.error = tr("Fichier illisible : {e}", { e: errText(e) });
    }
    return item;
  }

  function problems(it: Item): string[] {
    const p: string[] = [];
    if (it.status === "erreur") p.push(it.error);
    if (it.title.trim().length < 3) p.push(tr("titre trop court"));
    if (!it.code) p.push(tr("catégorie à choisir"));
    return p;
  }

  function stopPreview() { try { src?.stop(); } catch { /* déjà arrêté */ } src = null; st.playing = -1; }

  function play(i: number) {
    const it = st.items[i];
    const buf = it && buffers.get(it.path);
    if (st.playing === i) { stopPreview(); host.render(); return; }
    stopPreview();
    if (!buf || !ctx) return;
    src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(ctx.destination);
    src.onended = () => { if (st.playing === i) { st.playing = -1; host.render(); } };
    src.start();
    st.playing = i;
    host.render();
  }

  async function send() {
    const ready = st.items.filter((it) => !problems(it).length);
    if (!ready.length) { host.toast(tr("Aucun son prêt à envoyer.")); return; }
    if (st.pseudo.trim().length < 2) { host.toast(tr("Indiquez le pseudo qui sera crédité.")); return; }
    if (!EMAIL.test(st.email.trim())) { host.toast(tr("Indiquez une adresse e-mail valide.")); return; }
    if (!st.cc0) { host.toast(tr("Cochez la case : vous êtes l'auteur et publiez sous CC0.")); return; }
    st.sending = true;
    stopPreview();
    store.set("onde.contrib.pseudo", st.pseudo.trim());
    store.set("onde.email", st.email.trim());
    let ok = 0;
    for (const it of ready) {
      it.status = "envoi"; host.render();
      const cat = categories().find(([c]) => c === it.code);
      try {
        const id = await api.sendContribution(it.path, {
          title: it.title.trim(), code: it.code, category: cat?.[1] ?? "", description: it.description.trim(),
          tags: it.tags.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 12),
          pseudo: st.pseudo.trim(), email: st.email.trim(), license: "CC0", durationMs: it.durationMs,
        });
        st.sent = [{ id, title: it.title.trim(), code: it.code, date: new Date().toISOString() }, ...st.sent].slice(0, 200);
        store.set("onde.contrib.envoyes", st.sent);
        st.items = st.items.filter((x) => x !== it);
        ok++;
      } catch (e) {
        it.status = "erreur";
        it.error = errText(e);
      }
      host.render();
    }
    st.sending = false;
    st.sel = st.items.length ? 0 : -1;
    if (ok) { st.tab = st.items.length ? "envoyer" : "verification"; host.toast(tn(ok, "Son envoyé : merci !", "{n} sons envoyés : merci !")); }
    host.render();
  }

  // ---------- Affichage ----------
  function badge(it: Item): string {
    if (it.status === "envoi") return `<span class="cb-badge">${tr("ENVOI…")}</span>`;
    const p = problems(it);
    if (p.length) return `<span class="cb-badge warn" title="${esc(p.join(" · "))}">${it.status === "erreur" ? tr("ERREUR") : tr("À COMPLÉTER")}</span>`;
    return `<span class="cb-badge ok">${tr("PRÊT")}</span>`;
  }

  function main(): string {
    const pub = publishedIds();
    const waiting = st.sent.filter((s) => !pub.has(s.id));
    const published = host.catalog().filter((s) => s.contribution && st.sent.some((x) => x.id === s.contribution));
    const tabs: [typeof st.tab, string, number][] = [["envoyer", tr("À envoyer"), st.items.length], ["verification", tr("En vérification"), waiting.length], ["publies", tr("Publiés"), published.length]];
    let body = "";
    if (st.tab === "envoyer") {
      body = `<button class="cb-drop" data-act="cb-add"><span class="cb-up" aria-hidden="true">↑</span><b>${tr("Choisissez vos fichiers")}</b><span>${tr("WAV, FLAC, MP3, AIFF ou OGG · 3 minutes et 60 Mo au maximum par son")}</span></button>
        ${st.items.length ? `<div class="cb-list">${st.items.map((it, i) => `<div class="cb-row" data-act="cb-sel" data-i="${i}" aria-selected="${i === st.sel}">
          <button class="play ${st.playing === i ? "on" : ""}" data-act="cb-play" data-i="${i}" aria-label="${tr("Écouter")}">${st.playing === i ? "❚❚" : "▶"}</button>
          <div class="t"><b class="mono">${esc(it.name)}</b><span>${host.duration(it.durationMs)} · ${it.ext.toUpperCase()} ${it.sampleRate ? Math.round(it.sampleRate / 100) / 10 + " kHz" : ""} · ${it.channels === 1 ? "mono" : it.channels ? tr("stéréo") : ""}</span></div>
          ${it.code ? `<span class="code">${esc(it.code)}</span>` : ""}${badge(it)}
          <button class="cb-x" data-act="cb-remove" data-i="${i}" aria-label="${tr("Retirer")}">×</button></div>`).join("")}</div>` : ""}
        <div class="cb-info"><b>${tr("Avant de proposer un son :")}</b> ${tr("il doit venir de vous (pas d'un film, d'un jeu ou d'une autre banque de sons). Chaque son est écouté avant publication.")}</div>`;
    } else {
      const rows = st.tab === "verification"
        ? waiting.map((s) => `<div class="cb-row"><div class="t"><b>${esc(s.title)}</b><span>${tr("Envoyé le {date}", { date: new Date(s.date).toLocaleDateString(getLang() === "en" ? "en-US" : "fr-FR") })}</span></div><span class="code">${esc(s.code)}</span><span class="cb-badge">${tr("EN VÉRIFICATION")}</span></div>`)
        : published.map((s) => `<div class="cb-row"><div class="t"><b>${esc(soundTitle(s))}</b><span>${esc(s.credit ?? "")}</span></div><span class="code">${esc(s.code)}</span><span class="cb-badge ok">${tr("PUBLIÉ")}</span></div>`);
      body = rows.length ? `<div class="cb-list">${rows.join("")}</div>` : `<p class="empty">${st.tab === "verification" ? tr("Aucun son en attente de vérification.") : tr("Aucun son publié pour l'instant.")}</p>`;
    }
    return `<main class="cb-main">
      <h1>${tr("Mes contributions")}</h1>
      <p class="cb-lead">${tr("Vos sons rejoignent la bibliothèque gratuite après une vérification, crédités à votre nom.")}</p>
      <div class="segmented cb-tabs" role="tablist">${tabs.map(([v, l, n]) => `<button role="tab" data-act="cb-tab" data-value="${v}" aria-selected="${st.tab === v}">${l} · ${n}</button>`).join("")}</div>
      <div class="cb-soon"><span class="badge red">${tr("BIENTÔT")}</span><div><b>${tr("Vos sons vont bientôt vous rapporter.")}</b><span>${tr("Une partie des revenus d'Onde sera reversée aux créateurs, selon l'utilisation réelle de leurs sons.")}</span></div></div>
      ${body}
    </main>`;
  }

  function detail(): string {
    const it = st.items[st.sel];
    const ready = st.items.filter((x) => !problems(x).length).length;
    const who = `<div class="cb-who">
        <label class="fld"><span>${tr("Pseudo crédité")}</span><input id="cb-pseudo" value="${esc(st.pseudo)}" maxlength="40" placeholder="${tr("ex. camille.foley")}" /></label>
        <label class="fld"><span>E-mail <em>· ${tr("jamais publié")}</em></span><input id="cb-email" type="email" value="${esc(st.email)}" placeholder="${tr("vous@exemple.fr")}" /></label>
        <label class="cb-cc0"><input id="cb-cc0" type="checkbox" ${st.cc0 ? "checked" : ""} /><span>${tr("Je suis l'auteur de ces sons et je les publie sous licence <b>CC0</b> : tout le monde peut les utiliser librement, même commercialement.")}</span></label>
      </div>`;
    const send = `<button class="primary cb-send" data-act="cb-send" ${st.sending || !ready ? "disabled" : ""}>${st.sending ? tr("Envoi en cours…") : tn(ready, "Envoyer {n} son", "Envoyer {n} sons")}<span aria-hidden="true">→</span></button>
      <p class="hint">${tr("Vérification sous quelques jours. Le son apparaît ensuite dans la bibliothèque de tous les utilisateurs.")}</p>`;
    if (st.tab !== "envoyer" || !it) {
      return `<aside class="detail cb-detail">${who}<div class="cb-spacer"></div>${st.tab === "envoyer" ? send : ""}</aside>`;
    }
    const cats = categories();
    return `<aside class="detail cb-detail" aria-label="${tr("Détails du son")}">
      <span class="eyebrow">${tr("Détails · {i} sur {n}", { i: st.sel + 1, n: st.items.length })}</span>
      <div class="bigwave">${host.wave(it.peaks.length ? it.peaks : [0.05], 110, "base")}</div>
      ${it.status === "erreur" ? `<p class="fb-err">${esc(it.error)}</p>` : ""}
      <label class="fld"><span>${tr("Titre")}</span><input id="cb-title" value="${esc(it.title)}" maxlength="80" /></label>
      <label class="fld"><span>${tr("Catégorie")} <em>· ${tr("suggérée d'après le nom du fichier")}</em></span>
        <select id="cb-cat"><option value="">${tr("Choisir…")}</option>${cats.map(([c, n]) => `<option value="${c}" ${c === it.code ? "selected" : ""}>${c} · ${esc(catLabel(n))}</option>`).join("")}</select></label>
      <label class="fld"><span>${tr("Mots-clés")} <em>· ${tr("séparés par des virgules")}</em></span><input id="cb-tags" value="${esc(it.tags)}" placeholder="${tr("cape, tissu, mouvement")}" /></label>
      <label class="fld"><span>Description <em>· ${tr("facultative")}</em></span><textarea id="cb-desc" rows="3" maxlength="300" placeholder="${tr("Comment le son a été enregistré…")}">${esc(it.description)}</textarea></label>
      ${who}${send}
    </aside>`;
  }

  return {
    render(): { main: string; detail: string } { return { main: main(), detail: detail() }; },

    async action(act: string, el: HTMLElement): Promise<void> {
      const i = Number(el.closest<HTMLElement>("[data-i]")?.dataset.i ?? -1);
      switch (act) {
        case "cb-tab": st.tab = el.closest<HTMLElement>("[data-value]")!.dataset.value as typeof st.tab; break;
        case "cb-add": {
          const paths = await api.chooseAudioFiles();
          const fresh = paths.filter((p) => !st.items.some((x) => x.path === p));
          if (!fresh.length) return;
          host.toast(tn(fresh.length, "Analyse du fichier…", "Analyse de {n} fichiers…"));
          for (const p of fresh) st.items.push(await analyse(p));
          st.sel = st.items.length - fresh.length;
          st.tab = "envoyer";
          break;
        }
        case "cb-sel": if (i >= 0) st.sel = i; break;
        case "cb-play": if (i >= 0) { st.sel = i; play(i); } return;
        case "cb-remove": if (i >= 0) { if (st.playing === i) stopPreview(); buffers.delete(st.items[i].path); st.items.splice(i, 1); st.sel = Math.min(st.sel, st.items.length - 1); } break;
        case "cb-send": await send(); return;
      }
      host.render();
    },

    /** Champs du formulaire : mise à jour sans re-rendu (pour ne pas perdre le curseur). */
    input(t: HTMLInputElement): boolean {
      const it = st.items[st.sel];
      switch (t.id) {
        case "cb-title": if (it) it.title = t.value; return true;
        case "cb-tags": if (it) it.tags = t.value; return true;
        case "cb-desc": if (it) it.description = t.value; return true;
        case "cb-pseudo": st.pseudo = t.value; return true;
        case "cb-email": st.email = t.value; return true;
        case "cb-cat": if (it) { it.code = t.value; host.render(); } return true;
        case "cb-cc0": st.cc0 = t.checked; host.render(); return true;
      }
      return false;
    },

    stop: stopPreview,
  };
}
