// Test local du contenu partagé d'une équipe (sons, liens temporaires, playlists) avec D1 et R2 simulés.
// Usage : node site/test-equipe-partage.mjs
import { DatabaseSync } from "node:sqlite";
import * as compte from "./functions/api/compte/[[chemin]].js";
import * as equipe from "./functions/api/equipe/[[chemin]].js";
import * as admin from "./functions/api/admin/[[chemin]].js";
import * as fichier from "./functions/api/fichier-equipe/[[chemin]].js";

const sqlite = new DatabaseSync(":memory:");
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const store = new Map();
const EQUIPES = {
  put: async (k, v, o) => { store.set(k, { data: Buffer.from(v), meta: o?.httpMetadata }); },
  get: async (k, o) => {
    const x = store.get(k); if (!x) return null;
    const data = o?.range ? x.data.subarray(o.range.offset, o.range.offset + o.range.length) : x.data;
    return { body: data, httpMetadata: x.meta, size: x.data.length };
  },
  head: async (k) => { const x = store.get(k); return x ? { httpMetadata: x.meta, size: x.data.length } : null; },
  delete: async (k) => { store.delete(k); },
};
const env = { DB, EQUIPES, ONDE_DEV: "1", ADMIN_MOT_DE_PASSE: "pw" };

let fails = 0;
const check = (label, cond, info) => { console.log(`${cond ? "✓" : "✗"} ${label}`, cond ? "" : JSON.stringify(info)?.slice(0, 400)); if (!cond) fails++; };

async function call(mod, method, path, { token, data, raw, headers = {}, auth, e = env } = {}) {
  const h = { "CF-Connecting-IP": "10.0.0.1", ...headers };
  if (data) h["Content-Type"] = "application/json";
  if (token) h.Authorization = `Bearer ${token}`;
  if (auth) h.Authorization = "Basic " + Buffer.from("x:" + auth).toString("base64");
  if (raw) h["Content-Length"] = String(raw.length);
  const request = new Request(`https://onde.test/api/${path}`, { method, headers: h, body: raw ?? (data ? JSON.stringify(data) : undefined) });
  const r = await mod.onRequest({ request, env: e, params: { chemin: path.split("?")[0].split("/").slice(1) } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const C = (m, p, o) => call(compte, m, `compte/${p}`, o);
const E = (m, p, o) => call(equipe, m, `equipe/${p}`, o);
const A = (m, p, o) => call(admin, m, `admin/${p}`, { auth: "pw", ...o });

async function login(email) {
  const r = await C("POST", "code", { data: { email } });
  return (await C("POST", "connexion", { data: { email, code: r.body.devCode } })).body.token;
}
async function join(token) {
  const me = await C("GET", "moi", { token });
  for (const i of me.body.invitations) await C("POST", `invitations/${i.id}/accepter`, { token });
}

/** Petit WAV valide (en-tête RIFF/WAVE + silence). */
function wav(seconds = 0.1, tone = 0) {
  const n = Math.round(48000 * seconds), data = Buffer.alloc(n * 2);
  for (let i = 0; i < n; i++) data.writeInt16LE(Math.round(Math.sin(i * (0.05 + tone)) * 8000), i * 2);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(48000, 24); h.writeUInt32LE(96000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}
const meta = (o = {}) => ({ "X-Onde-Meta": encodeURIComponent(JSON.stringify({ title: "Whoosh maison", fileName: "whoosh-maison.wav", durationMs: 100, peaks: [0.1, 0.9, 0.4], tags: ["whoosh"], format: "WAV · 48 kHz · 16 bits · mono", ...o })) });

// ---------- Mise en place : une équipe, une propriétaire, un membre, une personne extérieure ----------
const team = (await A("POST", "equipes", { data: { name: "Studio Bêta", plan: "studio", seats: 5, storageGb: 1, status: "essai", ownerEmail: "alice@beta.fr" } })).body.team;
const alice = await login("alice@beta.fr"); await join(alice);
await E("POST", `${team.id}/invitations`, { token: alice, data: { email: "bob@beta.fr" } });
const bob = await login("bob@beta.fr"); await join(bob);
const eve = await login("eve@ailleurs.fr");

let r = await C("GET", "moi", { token: bob });
check("Onde+ inclus pour un membre d'une équipe active", r.body.plus === true, r.body);
r = await C("GET", "moi", { token: eve });
check("pas d'Onde+ sans équipe", r.body.plus === false, r.body);

// ---------- Envoi de sons ----------
const s1 = wav(0.1);
r = await E("POST", `${team.id}/sons`, { token: bob, raw: s1, headers: meta() });
check("un membre envoie un son", r.status === 200 && r.body.sound.title === "Whoosh maison", r);
const sid = r.body.sound.id;
r = await E("POST", `${team.id}/sons`, { token: alice, raw: s1, headers: meta({ title: "Copie" }) });
check("le même fichier n'est pas stocké deux fois", r.body.duplicate === true && r.body.sound.id === sid && store.size === 1, r.body);
r = await E("POST", `${team.id}/sons`, { token: bob, raw: Buffer.from("pas un son".repeat(30)), headers: meta() });
check("fichier non audio refusé", r.status === 415 && r.body.code === "format-inconnu", r);
r = await E("POST", `${team.id}/sons`, { token: eve, raw: s1, headers: meta() });
check("une personne extérieure ne peut pas envoyer", r.status === 403, r);
r = await E("POST", `${team.id}/sons`, { token: bob, raw: wav(0.1, 0.01), headers: meta() , e: { DB, ONDE_DEV: "1" } });
check("sans stockage configuré : erreur claire", r.status === 503 && r.body.code === "stockage-absent", r);

// ---------- Contenu et liens temporaires ----------
r = await E("GET", `${team.id}/contenu`, { token: alice });
check("contenu : 1 son avec un lien temporaire", r.status === 200 && r.body.sounds.length === 1 && r.body.sounds[0].url.includes("/api/fichier-equipe/"), r.body);
const version = r.body.version;
const url = new URL(r.body.sounds[0].url);
check("contenu : stockage utilisé compté", r.body.storageUsed === s1.length, r.body.storageUsed);
r = await E("GET", `${team.id}/contenu?v=${version}`, { token: alice });
check("rien de neuf : réponse courte", r.body.unchanged === true, r.body);

const get = async (u, headers = {}) => {
  const chemin = u.pathname.split("/").slice(3);
  return fichier.onRequestGet({ request: new Request(u, { headers }), env, params: { chemin } });
};
let f = await get(url);
check("le lien donne le fichier", f.status === 200 && Buffer.from(await f.arrayBuffer()).equals(s1), f.status);
f = await get(url, { Range: "bytes=0-43" });
check("lecture partielle (Range) pour la pré-écoute", f.status === 206 && f.headers.get("Content-Range") === `bytes 0-43/${s1.length}` && (await f.arrayBuffer()).byteLength === 44, f.status);
const forged = new URL(url); forged.pathname = forged.pathname.replace(/\/([0-9a-f]{40})\//, (m, s) => `/${s.slice(0, -1)}${s.endsWith("0") ? "1" : "0"}/`);
f = await get(forged);
check("lien falsifié refusé", f.status === 403, f.status);
const expired = new URL(url); expired.pathname = expired.pathname.replace(/\/(\d{9,12})\//, "/1000000000/");
f = await get(expired);
check("lien expiré refusé", f.status === 403, f.status);

// ---------- Droits sur les sons ----------
await E("POST", `${team.id}/sons`, { token: alice, raw: wav(0.2, 0.02), headers: meta({ title: "Impact d'Alice" }) });
r = await E("GET", `${team.id}/contenu`, { token: bob });
const aliceSound = r.body.sounds.find((x) => x.title === "Impact d'Alice");
r = await E("POST", `${team.id}/sons/${aliceSound.id}`, { token: bob, data: { title: "Piraté" } });
check("un membre ne renomme pas le son d'un autre", r.status === 403 && r.body.code === "reserve-auteur", r);
r = await E("POST", `${team.id}/sons/${sid}`, { token: bob, data: { title: "Whoosh de Bob", tags: ["air"] } });
check("l'auteur renomme son son", r.status === 200 && r.body.sound.title === "Whoosh de Bob", r);
r = await E("POST", `${team.id}/sons/${aliceSound.id}`, { token: alice, data: { title: "Impact final" } });
check("la propriétaire renomme", r.status === 200, r);

// ---------- Playlists partagées ----------
r = await E("POST", `${team.id}/playlists`, { token: bob, data: { name: "Pub Nike" } });
check("un membre crée une playlist", r.status === 200 && r.body.playlist.name === "Pub Nike", r);
const pl = r.body.playlist.id;
r = await E("POST", `${team.id}/playlists/${pl}/sons`, { token: alice, data: { ref: "bsb-0003" } });
check("on ajoute un son de la banque", r.status === 200, r);
r = await E("POST", `${team.id}/playlists/${pl}/sons`, { token: alice, data: { ref: `eq-${sid}` } });
check("on ajoute un son de l'équipe", r.status === 200, r);
r = await E("POST", `${team.id}/playlists/${pl}/sons`, { token: alice, data: { ref: "eq-inconnu" } });
check("un son d'équipe inconnu est refusé", r.status === 404, r);
await E("POST", `${team.id}/playlists/${pl}/sons`, { token: alice, data: { ref: "bsb-0003" } });
r = await E("GET", `${team.id}/contenu`, { token: bob });
check("playlist à jour chez Bob, sans doublon, dans l'ordre", JSON.stringify(r.body.playlists[0].ids) === JSON.stringify(["bsb-0003", `eq-${sid}`]), r.body.playlists);
r = await E("DELETE", `${team.id}/playlists/${pl}/sons/bsb-0003`, { token: bob });
r = await E("POST", `${team.id}/playlists/${pl}`, { token: bob, data: { name: "Pub Nike V2" } });
check("le créateur renomme sa playlist", r.status === 200, r);
const plAlice = (await E("POST", `${team.id}/playlists`, { token: alice, data: { name: "Ambiances" } })).body.playlist.id;
r = await E("DELETE", `${team.id}/playlists/${plAlice}`, { token: bob });
check("un membre ne supprime pas la playlist d'un autre", r.status === 403 && r.body.code === "reserve-createur", r);

// ---------- Suppression d'un son : retiré des playlists ----------
r = await E("DELETE", `${team.id}/sons/${sid}`, { token: bob });
check("l'auteur supprime son son", r.status === 200 && ![...store.keys()].some((k) => k.includes(sid)), r);
r = await E("GET", `${team.id}/contenu`, { token: bob });
check("le son disparaît aussi des playlists", r.body.playlists.find((p) => p.id === pl).ids.length === 0 && r.body.sounds.length === 1, r.body);

// ---------- Quota ----------
await A("POST", `equipes/${team.id}`, { data: { storageGb: 1 } });
sqlite.prepare("UPDATE sons_equipe SET size = ?1 WHERE team_id = ?2").run(1024 ** 3, team.id);
r = await E("POST", `${team.id}/sons`, { token: bob, raw: wav(0.3, 0.03), headers: meta() });
check("stockage plein : envoi refusé", r.status === 413 && r.body.code === "quota-depasse", r);
sqlite.prepare("UPDATE sons_equipe SET size = 100 WHERE team_id = ?1").run(team.id);

// ---------- Fin de l'essai : tout est bloqué, y compris les liens ----------
r = await E("GET", `${team.id}/contenu`, { token: bob });
const live = new URL(r.body.sounds[0].url);
await A("POST", `equipes/${team.id}`, { data: { trialUntil: "2020-01-01T00:00:00Z" } });
r = await E("GET", `${team.id}/contenu`, { token: bob });
check("essai terminé : contenu bloqué", r.status === 403 && r.body.code === "equipe-inactive", r);
f = await get(live);
check("essai terminé : liens bloqués", f.status === 403, f.status);
r = await C("GET", "moi", { token: bob });
check("essai terminé : plus d'Onde+", r.body.plus === false, r.body.plus);
r = await E("GET", team.id, { token: bob });
check("mais on voit toujours l'équipe et ses membres", r.status === 200, r);

// ---------- Suppression de l'équipe : stockage vidé ----------
await A("DELETE", `equipes/${team.id}`);
check("équipe supprimée : plus aucun fichier stocké", store.size === 0, [...store.keys()]);

console.log(fails ? `\n${fails} échec(s)` : "\nTout est bon.");
process.exit(fails ? 1 : 0);
