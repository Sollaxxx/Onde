"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

  // src/search.ts
  function normalize(s) {
    return s.replace(/œ/g, "oe").replace(/Œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  var SYNONYMS = {
    boom: ["impact"],
    hit: ["impact"],
    trailer: ["bande-annonce"],
    door: ["porte"],
    porte: ["door"],
    rain: ["pluie"],
    wind: ["vent"],
    click: ["clic"],
    clic: ["click"],
    steps: ["pas"],
    footsteps: ["pas"],
    heart: ["coeur"],
    swoosh: ["whoosh"],
    woosh: ["whoosh"],
    whoosh: ["swoosh"],
    riser: ["montee"],
    clock: ["horloge"],
    radio: ["parasite"],
    drone: ["nappe"],
    ui: ["interface"]
  };
  var STOP = new Set("a au aux avec d de des du en et l la le les sur un une qui que dans par pour the of on in with and to for at".split(" "));
  var indexCache = /* @__PURE__ */ new WeakMap();
  var words = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
  function indexOf(s) {
    var _a2, _b2, _c, _d;
    let idx = indexCache.get(s);
    if (!idx) {
      idx = {
        title: words(`${s.title} ${(_a2 = s.titleEn) != null ? _a2 : ""}`),
        tags: words(`${s.tags.join(" ")} ${s.category} ${s.code} ${(_b2 = s.ucs) != null ? _b2 : ""}`),
        desc: words(`${(_c = s.description) != null ? _c : ""} ${(_d = s.descriptionEn) != null ? _d : ""}`)
      };
      indexCache.set(s, idx);
    }
    return idx;
  }
  function wordScore(idx, w) {
    var _a2;
    const hit = (list) => list.some((x) => x.startsWith(w));
    const alts = [w, ...(_a2 = SYNONYMS[w]) != null ? _a2 : []];
    if (alts.some((a) => idx.title.some((x) => x.startsWith(a)))) return 3;
    if (alts.some((a) => idx.tags.some((x) => x.startsWith(a)))) return 2;
    return hit(idx.desc) || alts.some((a) => idx.desc.some((x) => x.startsWith(a))) ? 1 : 0;
  }
  function search(catalog, query) {
    const qs = words(query).filter((w) => !STOP.has(w));
    if (!qs.length) return catalog;
    const scored = [];
    catalog.forEach((s, i) => {
      const idx = indexOf(s);
      let score = 0;
      for (const w of qs) {
        const k = wordScore(idx, w);
        if (!k) return;
        score += k;
      }
      scored.push({ s, score, i });
    });
    return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
  }
  function formatDuration(ms) {
    const total = ms / 1e3;
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
  }

  // premiere/src/ui.ts
  var CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
  var PAGE = 60;
  function startPanel(host2) {
    const state = {
      catalog: [],
      results: [],
      limit: PAGE,
      selId: null,
      playingId: null,
      libDir: "",
      local: /* @__PURE__ */ new Map(),
      inflight: /* @__PURE__ */ new Map(),
      busy: /* @__PURE__ */ new Set()
    };
    const $ = (id) => document.getElementById(id);
    const listEl = $("list");
    const statusEl = $("status");
    const player = $("player");
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const byId = (id) => {
      var _a2;
      return (_a2 = state.catalog.find((s) => s.id === id)) != null ? _a2 : null;
    };
    const soundUrl = (s) => `${CDN}/sons/${encodeURIComponent(s.file)}`;
    function up(el, attr) {
      var _a2;
      let n = el;
      while (n && n !== listEl) {
        if (((_a2 = n.getAttribute) == null ? void 0 : _a2.call(n, attr)) != null) return n;
        n = n.parentElement;
      }
      return null;
    }
    const rowOf = (el) => {
      var _a2, _b2;
      return byId((_b2 = (_a2 = up(el, "data-id")) == null ? void 0 : _a2.getAttribute("data-id")) != null ? _b2 : null);
    };
    function status(msg, kind = "") {
      statusEl.textContent = msg;
      statusEl.parentElement.className = `foot ${kind}`;
    }
    const errText = (e) => e instanceof Error ? e.message : String(e);
    function ensureLocal(s) {
      const known = state.local.get(s.id);
      if (known) return Promise.resolve(known);
      let job = state.inflight.get(s.id);
      if (job) return job;
      const dest = [state.libDir, s.code, s.file].join(host2.sep);
      job = host2.download(soundUrl(s), dest).then(() => {
        state.local.set(s.id, dest);
        state.inflight.delete(s.id);
        markReady(s.id);
        return dest;
      }, (e) => {
        state.inflight.delete(s.id);
        throw e;
      });
      state.inflight.set(s.id, job);
      return job;
    }
    async function insert(s) {
      if (state.busy.has(s.id)) return;
      state.busy.add(s.id);
      renderList();
      try {
        status(`Téléchargement de « ${s.title} »…`);
        const path = await ensureLocal(s);
        status("Insertion dans la séquence…");
        status(await host2.insert(path, s.durationMs / 1e3, s.title), "ok");
        void host2.markUsed(path).catch(() => {
        });
      } catch (e) {
        status(`Insertion impossible : ${errText(e)}`, "err");
      } finally {
        state.busy.delete(s.id);
        renderList();
      }
    }
    function togglePlay(s) {
      var _a2;
      if (state.playingId === s.id) {
        player.pause();
        state.playingId = null;
      } else {
        player.src = soundUrl(s);
        state.playingId = s.id;
        const p = player.play();
        (_a2 = p == null ? void 0 : p.catch) == null ? void 0 : _a2.call(p, () => {
          state.playingId = null;
          status("Pré-écoute indisponible dans cette version de Premiere.", "err");
          renderList();
        });
        void ensureLocal(s).catch(() => {
        });
      }
      state.selId = s.id;
      renderList();
    }
    player.addEventListener("ended", () => {
      state.playingId = null;
      renderList();
    });
    player.addEventListener("error", () => {
      if (state.playingId) status("Pré-écoute indisponible pour ce son.", "err");
      state.playingId = null;
      renderList();
    });
    function markReady(id) {
      const row = listEl.querySelector(`.row[data-id="${id}"]`);
      if (row && host2.canDrag) {
        row.classList.add("ready");
        row.setAttribute("draggable", "true");
      }
    }
    listEl.addEventListener("dragstart", (e) => {
      const s = rowOf(e.target);
      const path = s ? state.local.get(s.id) : void 0;
      if (!s || !path || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      host2.setDragData(e.dataTransfer, path, s);
      void host2.markUsed(path).catch(() => {
      });
      status(`Lâchez « ${s.title} » dans la timeline ou le panneau Projet.`);
    });
    listEl.addEventListener("mouseover", (e) => {
      if (!host2.canDrag) return;
      const s = rowOf(e.target);
      if (s && !state.local.has(s.id)) void ensureLocal(s).catch(() => {
      });
    });
    function waveBars(peaks, bars = 16) {
      let out = "";
      const step = peaks.length / bars;
      for (let i = 0; i < bars; i++) {
        const slice = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
        const h = Math.max(2, Math.round(Math.max(...slice) * 20));
        out += `<i style="height:${h}px"></i>`;
      }
      return out;
    }
    function renderList() {
      const list = state.results.slice(0, state.limit);
      if (!list.length) {
        listEl.innerHTML = `<p class="empty">Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».</p>`;
        return;
      }
      const hint = host2.canDrag ? "Glissez vers la timeline, ou cliquez Insérer" : "Cliquez Insérer pour poser le son à la tête de lecture";
      const rows = list.map((s) => {
        const sel = s.id === state.selId;
        const playing = s.id === state.playingId;
        const ready = host2.canDrag && state.local.has(s.id);
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
    function runSearch(q) {
      state.results = search(state.catalog, q);
      state.limit = PAGE;
      $("count").textContent = `${state.results.length} SONS`;
      listEl.scrollTop = 0;
      renderList();
    }
    listEl.addEventListener("click", (e) => {
      var _a2;
      const act = (_a2 = up(e.target, "data-act")) == null ? void 0 : _a2.getAttribute("data-act");
      if (act === "more") {
        state.limit += PAGE * 2;
        renderList();
        return;
      }
      const s = rowOf(e.target);
      if (!s) return;
      if (act === "play") togglePlay(s);
      else if (act === "insert") void insert(s);
      else {
        state.selId = s.id;
        renderList();
      }
    });
    listEl.addEventListener("dblclick", (e) => {
      const s = rowOf(e.target);
      if (s) void insert(s);
    });
    let timer;
    $("q").addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(v), 120);
    });
    void (async () => {
      try {
        state.libDir = await host2.libraryDir();
        const data = await host2.getJson(`${CDN}/catalogue/v1.json`);
        state.catalog = data.sounds.sort((a, b) => a.title.localeCompare(b.title, "fr"));
        runSearch("");
        status(host2.canDrag ? "Glissez un son vers la timeline, ou cliquez Insérer." : "Cliquez Insérer pour poser un son à la tête de lecture.");
      } catch (e) {
        status(`Impossible de charger la bibliothèque : ${errText(e)}`, "err");
      }
    })();
  }

  // premiere/src/host-uxp.ts
  var ppro = __require("premierepro");
  var uxp = __require("uxp");
  var fs = __require("fs");
  var os = __require("os");
  var isWin = os.platform().startsWith("win");
  var SEP = isWin ? "\\" : "/";
  var join = (...parts) => parts.join(SEP);
  var BIN = "Onde";
  var norm = (p) => p.replace(/\\/g, "/").toLowerCase();
  async function exists(p) {
    try {
      await fs.lstat(p);
      return true;
    } catch {
      return false;
    }
  }
  function configDir() {
    const home = os.homedir();
    return isWin ? join(home, "AppData", "Roaming", "app.onde.desktop") : join(home, "Library", "Application Support", "app.onde.desktop");
  }
  var _a, _b;
  var major = parseInt(String((_b = (_a = uxp.host) == null ? void 0 : _a.version) != null ? _b : "0").split(".")[0], 10) || 0;
  async function findOrCreateBin(project) {
    const find = async () => {
      const root2 = await project.getRootItem();
      for (const item of await root2.getItems()) {
        const folder = ppro.FolderItem.cast(item);
        if (folder && item.name === BIN) return folder;
      }
      return null;
    };
    let bin = await find();
    if (bin) return bin;
    const root = await project.getRootItem();
    project.lockedAccess(() => {
      project.executeTransaction((ca) => ca.addAction(root.createBinAction(BIN, false)), "Onde : créer le chutier");
    });
    bin = await find();
    return bin != null ? bin : root;
  }
  async function findClip(bin, path) {
    const want = norm(path);
    for (const item of await bin.getItems()) {
      const clip = ppro.ClipProjectItem.cast(item);
      if (!clip) continue;
      try {
        if (norm(await clip.getMediaFilePath()) === want) return clip;
      } catch {
      }
    }
    return null;
  }
  async function freeAudioTrack(seq, start, end) {
    const count = await seq.getAudioTrackCount();
    for (let i = 0; i < count; i++) {
      const track = await seq.getAudioTrack(i);
      const items = await track.getTrackItems(ppro.Constants.TrackItemType.CLIP, false);
      let free = true;
      for (const it of items != null ? items : []) {
        const a = (await it.getStartTime()).seconds;
        const b = (await it.getEndTime()).seconds;
        if (a < end && b > start) {
          free = false;
          break;
        }
      }
      if (free) return i;
    }
    return count;
  }
  function timecode(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  var MIME = { wav: "audio/wav", mp3: "audio/mpeg", aif: "audio/aif", aiff: "audio/x-aiff", m4a: "audio/m4a" };
  function fileUri(path) {
    let p = path;
    if (/^[A-Za-z]:\\/.test(p)) p = "/" + p.replace(/\\/g, "/");
    return "file://" + encodeURI(p);
  }
  var host = {
    canDrag: major >= 27,
    // glisser-déposer depuis un panneau UXP : Premiere 27.0 et plus
    sep: SEP,
    async libraryDir() {
      const home = os.homedir();
      const cfg = configDir();
      try {
        const hint = String(await fs.readFile(join(cfg, "bibliotheque.txt"), { encoding: "utf-8" })).trim();
        if (hint) return hint;
      } catch {
      }
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
        ok = project.executeTransaction((ca) => ca.addAction(editor.createOverwriteItemAction(clip, pos, 0, track)), `Onde : ${title}`);
      });
      if (!ok) throw new Error("Premiere a refusé l'insertion");
      return `« ${title} » posé sur A${track + 1} à ${timecode(start)}.`;
    },
    async markUsed(path) {
      const cfg = configDir();
      await fs.mkdir(cfg, { recursive: true }).catch(() => 0);
      const file = join(cfg, "sons-glisses.txt");
      let prev = "";
      try {
        prev = String(await fs.readFile(file, { encoding: "utf-8" }));
      } catch {
      }
      await fs.writeFile(file, prev + path + "\n", { encoding: "utf-8" });
    },
    setDragData(dt, path, sound) {
      var _a2;
      const ext = sound.file.split(".").pop().toLowerCase();
      dt.setData("text/plain", JSON.stringify({
        version: "1.0.0",
        items: [{ name: sound.file, display_name: sound.title, content_type: (_a2 = MIME[ext]) != null ? _a2 : "audio/wav", uri: fileUri(path) }]
      }));
      dt.effectAllowed = "copyMove";
      dt.dropEffect = "copy";
    }
  };
  startPanel(host);
})();
