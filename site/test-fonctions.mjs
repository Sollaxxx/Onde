// Test local des fonctions du site (contributions + modération) avec D1 et R2 simulés.
// Usage : node site/test-fonctions.mjs <fichier.wav>
import { DatabaseSync } from "node:sqlite";
import { readFileSync } from "node:fs";
import * as config from "./functions/api/config.js";
import * as contributions from "./functions/api/contributions.js";
import * as modMw from "./functions/api/moderation/_middleware.js";
import * as liste from "./functions/api/moderation/liste.js";
import * as fichier from "./functions/api/moderation/fichier.js";
import * as reglages from "./functions/api/moderation/reglages.js";
import * as publier from "./functions/api/moderation/publier.js";
import * as refuser from "./functions/api/moderation/refuser.js";
import * as categories from "./functions/api/moderation/categories.js";

const sqlite = new DatabaseSync(":memory:");
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const store = new Map();
const SONS = {
  put: async (k, v, o) => { store.set(k, { data: typeof v === "string" ? Buffer.from(v) : Buffer.from(v), meta: o?.httpMetadata }); },
  get: async (k) => { const o = store.get(k); if (!o) return null; return { body: o.data, httpMetadata: o.meta, json: async () => JSON.parse(o.data.toString()) }; },
  delete: async (k) => { store.delete(k); },
};
store.set("catalogue/v1.json", { data: Buffer.from(JSON.stringify({ version: 1, count: 2, sounds: [{ id: "bsb-1", code: "DOOR", category: "Portes", title: "Porte" }, { id: "bsb-2", code: "SWSH", category: "Whooshes", title: "Whoosh" }] })) });
const PASS = "secret-test";
const env = { DB, SONS, MODERATION_MOT_DE_PASSE: PASS };
const auth = { Authorization: "Basic " + Buffer.from("x:" + PASS).toString("base64") };
const wav = readFileSync(process.argv[2]);
const meta = (o = {}) => encodeURIComponent(JSON.stringify({ title: "Whoosh de cape", code: "SWSH", category: "Whooshes", tags: ["cape", "tissu"], description: "test", pseudo: "camille", email: "camille@exemple.fr", license: "CC0", durationMs: 1090, ...o }));
const post = (body, m, extra = {}) => new Request("https://x/api/contributions", { method: "POST", body, headers: { "X-Onde-Meta": m, "Content-Length": String(body.length ?? body.byteLength), "CF-Connecting-IP": "1.2.3.4", ...extra } });
const mod = async (handler, req, e = env) => modMw.onRequest({ request: req, env: e, next: () => handler({ request: req, env: e }) });
const body = async (r) => [r.status, await r.json().catch(async () => await r.text())];
let fails = 0;
const check = (label, cond, info) => { console.log(`${cond ? "✓" : "✗"} ${label}`, cond ? "" : JSON.stringify(info)); if (!cond) fails++; };

let r = await body(await config.onRequestGet({ env }));
check("interrupteur fermé par défaut", r[0] === 200 && r[1].contributions === false, r);
r = await body(await contributions.onRequestPost({ request: post(wav, meta()), env }));
check("envoi refusé tant que c'est fermé", r[0] === 403, r);
r = await mod(liste.onRequestGet, new Request("https://x/api/moderation/liste"), { ...env, MODERATION_MOT_DE_PASSE: undefined });
check("modération verrouillée sans mot de passe configuré", r.status === 503, r.status);
r = await mod(liste.onRequestGet, new Request("https://x/api/moderation/liste", { headers: { Authorization: "Basic " + Buffer.from("x:faux").toString("base64") } }));
check("mauvais mot de passe refusé", r.status === 401, r.status);
r = await body(await mod(reglages.onRequestPost, new Request("https://x/api/moderation/reglages", { method: "POST", headers: auth, body: JSON.stringify({ contributions: true }) })));
check("ouverture par la modération", r[1].open === true, r);
r = await body(await config.onRequestGet({ env }));
check("interrupteur ouvert", r[1].contributions === true, r);
r = await body(await contributions.onRequestPost({ request: post(Buffer.from("ceci n'est pas un son".repeat(100)), meta()), env }));
check("fichier non audio refusé", r[0] === 415, r);
r = await body(await contributions.onRequestPost({ request: post(wav, meta({ license: "autre" })), env }));
check("licence CC0 obligatoire", r[0] === 400, r);
r = await body(await contributions.onRequestPost({ request: post(wav, meta()), env }));
check("envoi accepté", r[0] === 200 && r[1].ok, r);
const id = r[1].id;
r = await body(await contributions.onRequestPost({ request: post(wav, meta({ title: "Deuxième son" })), env }));
const id2 = r[1].id;
r = await body(await mod(liste.onRequestGet, new Request("https://x/api/moderation/liste", { headers: auth })));
check("deux sons en attente", r[1].pending.length === 2 && r[1].pending[0].tags[0] === "cape", r[1].pending?.length);
r = await mod(fichier.onRequestGet, new Request(`https://x/api/moderation/fichier?id=${id}`, { headers: auth }));
check("le fichier d'origine se télécharge", r.status === 200 && (await r.arrayBuffer()).byteLength === wav.length, r.status);
r = await body(await mod(categories.onRequestGet, new Request("https://x/api/moderation/categories", { headers: auth })));
check("catégories lues dans le catalogue", r[1].categories.length === 2, r);
const pm = encodeURIComponent(JSON.stringify({ id, title: "Whoosh de cape", titleEn: "Cape whoosh", code: "SWSH", category: "Whooshes", tags: ["cape"], durationMs: 1000, peaks: [0.1, 1] }));
r = await body(await mod(publier.onRequestPost, new Request("https://x/api/moderation/publier", { method: "POST", headers: { ...auth, "X-Onde-Meta": pm }, body: wav })));
check("publication", r[1].ok && r[1].count === 3, r);
const cat = JSON.parse(store.get("catalogue/v1.json").data.toString());
const e = cat.sounds.find((s) => s.contribution === id);
check("le son est dans le catalogue, crédité", e && e.credit === "camille · communauté Onde" && e.file.startsWith("SWSH_Whoosh-de-cape_C") && store.has("sons/" + e.file), e);
check("l'original en attente est supprimé", ![...store.keys()].some((k) => k.includes(id) && k.startsWith("contributions/")), [...store.keys()]);
r = await body(await mod(refuser.onRequestPost, new Request("https://x/api/moderation/refuser", { method: "POST", headers: auth, body: JSON.stringify({ id: id2, note: "test" }) })));
check("refus", r[1].ok, r);
r = await body(await mod(liste.onRequestGet, new Request("https://x/api/moderation/liste", { headers: auth })));
check("plus rien en attente, décisions listées", r[1].pending.length === 0 && r[1].recent.length === 2 && r[1].counts.publie === 1 && r[1].counts.refuse === 1, r[1]);
console.log(fails ? `${fails} échec(s)` : "Tout est bon.");
process.exit(fails ? 1 : 0);
