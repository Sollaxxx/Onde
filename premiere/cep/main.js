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
    let idx = indexCache.get(s);
    if (!idx) {
      idx = {
        title: words(`${s.title} ${s.titleEn ?? ""}`),
        tags: words(`${s.tags.join(" ")} ${s.category} ${s.code} ${s.ucs ?? ""}`),
        desc: words(`${s.description ?? ""} ${s.descriptionEn ?? ""}`)
      };
      indexCache.set(s, idx);
    }
    return idx;
  }
  function wordScore(idx, w) {
    const hit = (list) => list.some((x) => x.startsWith(w));
    const alts = [w, ...SYNONYMS[w] ?? []];
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
    const byId = (id) => state.catalog.find((s) => s.id === id) ?? null;
    const soundUrl = (s) => `${CDN}/sons/${encodeURIComponent(s.file)}`;
    function up(el, attr) {
      var _a;
      let n = el;
      while (n && n !== listEl) {
        if (((_a = n.getAttribute) == null ? void 0 : _a.call(n, attr)) != null) return n;
        n = n.parentElement;
      }
      return null;
    }
    const rowOf = (el) => {
      var _a;
      return byId(((_a = up(el, "data-id")) == null ? void 0 : _a.getAttribute("data-id")) ?? null);
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
        const path2 = await ensureLocal(s);
        status("Insertion dans la séquence…");
        status(await host2.insert(path2, s.durationMs / 1e3, s.title), "ok");
        void host2.markUsed(path2).catch(() => {
        });
      } catch (e) {
        status(`Insertion impossible : ${errText(e)}`, "err");
      } finally {
        state.busy.delete(s.id);
        renderList();
      }
    }
    function togglePlay(s) {
      var _a;
      if (state.playingId === s.id) {
        player.pause();
        state.playingId = null;
      } else {
        player.src = soundUrl(s);
        state.playingId = s.id;
        const p = player.play();
        (_a = p == null ? void 0 : p.catch) == null ? void 0 : _a.call(p, () => {
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
      const path2 = s ? state.local.get(s.id) : void 0;
      if (!s || !path2 || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      host2.setDragData(e.dataTransfer, path2, s);
      void host2.markUsed(path2).catch(() => {
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
      var _a;
      const act = (_a = up(e.target, "data-act")) == null ? void 0 : _a.getAttribute("data-act");
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

  // premiere/src/host-cep.ts
  var fs = __require("fs");
  var os = __require("os");
  var path = __require("path");
  var https = __require("https");
  var isWin = process.platform === "win32";
  function evalScript(code) {
    return new Promise((resolve, reject) => {
      const cep = window.__adobe_cep__;
      if (!cep) {
        reject(new Error("panneau ouvert hors de Premiere"));
        return;
      }
      cep.evalScript(code, (res) => resolve(res));
    });
  }
  function get(url, redirects = 3) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "Onde-Premiere" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(get(res.headers.location, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(`réponse ${res.statusCode}`));
          return;
        }
        resolve(res);
      }).on("error", reject);
    });
  }
  var ERRORS = {
    noproject: "ouvrez d'abord un projet",
    nosequence: "ouvrez une séquence dans la timeline",
    import: "le son n'a pas pu être importé",
    notrack: "aucune piste audio libre à la tête de lecture"
  };
  function timecode(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function applyHostTheme() {
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
    } catch {
    }
  }
  function configDir() {
    const home = os.homedir();
    return isWin ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "app.onde.desktop") : path.join(home, "Library", "Application Support", "app.onde.desktop");
  }
  var host = {
    canDrag: true,
    sep: path.sep,
    async libraryDir() {
      const home = os.homedir();
      const cfg = configDir();
      try {
        const hint = fs.readFileSync(path.join(cfg, "bibliotheque.txt"), "utf8").trim();
        if (hint) return hint;
      } catch {
      }
      for (const docs of [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents")]) {
        if (fs.existsSync(path.join(docs, "Onde"))) return path.join(docs, "Onde");
      }
      return path.join(home, "Documents", "Onde");
    },
    async getJson(url) {
      const res = await get(url);
      const chunks = [];
      for await (const c of res) chunks.push(c);
      return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    },
    async download(url, dest) {
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
    },
    async insert(file, durationSec, title) {
      const raw = await evalScript(`ondeInsert(${JSON.stringify(file)}, ${durationSec})`);
      let res;
      try {
        res = JSON.parse(raw);
      } catch {
        throw new Error(raw || "Premiere n'a pas répondu");
      }
      if (!res.ok) throw new Error(ERRORS[res.error] ?? res.error);
      return `« ${title} » posé sur A${res.track + 1} à ${timecode(res.start)}.`;
    },
    async markUsed(file) {
      const cfg = configDir();
      fs.mkdirSync(cfg, { recursive: true });
      fs.appendFileSync(path.join(cfg, "sons-glisses.txt"), file + "\n", "utf8");
    },
    setDragData(dt, file, _sound) {
      dt.setData("com.adobe.cep.dnd.file.0", file);
      dt.effectAllowed = "copy";
    }
  };
  applyHostTheme();
  startPanel(host);
})();
