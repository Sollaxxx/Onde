// Test local des comptes et des équipes (Onde Équipe) avec une base D1 simulée.
// Usage : node site/test-equipe.mjs
import { DatabaseSync } from "node:sqlite";
import * as compte from "./functions/api/compte/[[chemin]].js";
import * as equipe from "./functions/api/equipe/[[chemin]].js";
import * as admin from "./functions/api/admin/[[chemin]].js";
import * as config from "./functions/api/config.js";

const sqlite = new DatabaseSync(":memory:");
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
});
const DB = { prepare: (sql) => stmt(sql), batch: async (list) => { for (const s of list) await s.run(); } };
const PASS = "admin-test";
const env = { DB, ONDE_DEV: "1", ADMIN_MOT_DE_PASSE: PASS };

let fails = 0;
const check = (label, cond, info) => { console.log(`${cond ? "✓" : "✗"} ${label}`, cond ? "" : JSON.stringify(info)); if (!cond) fails++; };

let ip = 1;
async function call(mod, method, path, { token, data, lang, auth, e = env } = {}) {
  const headers = { "Content-Type": "application/json", "CF-Connecting-IP": `10.0.0.${ip}` };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (auth) headers.Authorization = "Basic " + Buffer.from("x:" + auth).toString("base64");
  if (lang) headers["X-Onde-Langue"] = lang;
  const request = new Request(`https://x/api/${path}`, { method, headers, body: data ? JSON.stringify(data) : undefined });
  const chemin = path.split("/").slice(1);
  const r = await mod.onRequest({ request, env: e, params: { chemin } });
  return { status: r.status, body: await r.json().catch(() => null) };
}
const C = (method, path, o) => call(compte, method, `compte/${path}`, o);
const E = (method, path, o) => call(equipe, method, `equipe/${path}`, o);
const A = (method, path, o) => call(admin, method, `admin/${path}`, { auth: PASS, ...o });

async function login(email) {
  const r = await C("POST", "code", { data: { email } });
  const s = await C("POST", "connexion", { data: { email, code: r.body.devCode, device: "test" } });
  return s.body.token;
}

// ---------- Connexion ----------
let r = await C("POST", "code", { data: { email: "pas-un-mail" } });
check("e-mail invalide refusé", r.status === 400 && r.body.code === "email-invalide", r);
r = await C("POST", "code", { data: { email: "pas-un-mail" }, lang: "en" });
check("message d'erreur en anglais", r.body.error === "Invalid email address.", r);
r = await C("POST", "code", { data: { email: "Alice@Studio.fr" } });
check("code envoyé (mode test)", r.status === 200 && /^\d{6}$/.test(r.body.devCode), r);
const code = r.body.devCode;
r = await C("POST", "connexion", { data: { email: "alice@studio.fr", code: code === "000000" ? "111111" : "000000" } });
check("mauvais code refusé", r.status === 400 && r.body.code === "code-incorrect", r);
r = await C("POST", "connexion", { data: { email: "alice@studio.fr", code } });
check("bon code : session ouverte", r.status === 200 && r.body.token?.length > 30 && r.body.account.email === "alice@studio.fr", r);
const alice = r.body.token;
r = await C("POST", "connexion", { data: { email: "alice@studio.fr", code } });
check("un code ne sert qu'une fois", r.status === 400 && r.body.code === "code-expire", r);

// Cinq essais ratés : le code est détruit
r = await C("POST", "code", { data: { email: "eve@exemple.fr" } });
const eveCode = r.body.devCode;
for (let i = 0; i < 4; i++) await C("POST", "connexion", { data: { email: "eve@exemple.fr", code: String((Number(eveCode) + 1 + i) % 1e6).padStart(6, "0") } });
r = await C("POST", "connexion", { data: { email: "eve@exemple.fr", code: String((Number(eveCode) + 9) % 1e6).padStart(6, "0") } });
check("5e essai raté : trop d'essais", r.status === 429 && r.body.code === "trop-d-essais", r);
r = await C("POST", "connexion", { data: { email: "eve@exemple.fr", code: eveCode } });
check("après 5 essais, même le bon code ne marche plus", r.status === 400, r);

// Limite de demandes de code
ip = 2;
for (let i = 0; i < 5; i++) await C("POST", "code", { data: { email: "spam@exemple.fr" } });
r = await C("POST", "code", { data: { email: "spam@exemple.fr" } });
check("6e demande de code dans l'heure refusée", r.status === 429, r);
ip = 3;

r = await C("GET", "moi", { token: alice });
check("profil : aucun équipe au départ", r.status === 200 && r.body.teams.length === 0 && r.body.invitations.length === 0, r);
r = await C("POST", "moi", { token: alice, data: { name: "Alice" } });
check("nom enregistré", r.body.account?.name === "Alice", r);
r = await C("GET", "moi", { token: "faux-jeton-faux-jeton-faux-jeton" });
check("faux jeton refusé", r.status === 401, r);

// ---------- Administration ----------
r = await A("GET", "equipes", { auth: "mauvais" });
check("admin : mauvais mot de passe refusé", r.status === 401, r);
r = await A("GET", "equipes", { e: { ...env, ADMIN_MOT_DE_PASSE: undefined } });
check("admin : fermé sans mot de passe configuré", r.status === 503, r);
r = await A("POST", "equipes", { data: { name: "Studio Alpha", plan: "studio", seats: 2, status: "essai", trialDays: 30, ownerEmail: "alice@studio.fr" } });
check("admin : équipe créée à l'essai", r.status === 200 && r.body.team.status === "essai" && r.body.team.active && r.body.team.seats === 2, r);
const teamId = r.body.team.id;

r = await C("GET", "moi", { token: alice });
check("Alice voit l'invitation de propriétaire", r.body.invitations.length === 1 && r.body.invitations[0].role === "proprietaire", r);
r = await C("POST", `invitations/${r.body.invitations[0].id}/accepter`, { token: alice });
check("Alice accepte et devient propriétaire", r.status === 200 && r.body.team.role === "proprietaire", r);

// ---------- Gestion par la propriétaire ----------
r = await E("POST", `${teamId}/invitations`, { token: alice, data: { email: "bob@studio.fr" } });
check("Alice invite Bob", r.status === 200 && r.body.emailSent, r);
r = await E("POST", `${teamId}/invitations`, { token: alice, data: { email: "carla@studio.fr" } });
check("forfait plein (2 places) : Carla refusée", r.status === 409 && r.body.code === "plus-de-place", r);
r = await E("POST", `${teamId}/invitations`, { token: alice, data: { email: "bob@studio.fr" } });
check("renvoyer l'invitation de Bob ne prend pas de place", r.status === 200 && r.body.resent, r);
r = await E("GET", teamId, { token: alice });
check("détail : 1 membre, 1 invitation, 2/2 places", r.body.team.members.length === 1 && r.body.team.invitations.length === 1 && r.body.team.seatsUsed === 2, r);

const bob = await login("bob@studio.fr");
r = await C("GET", "moi", { token: bob });
r = await C("POST", `invitations/${r.body.invitations[0].id}/accepter`, { token: bob });
check("Bob rejoint l'équipe comme membre", r.status === 200 && r.body.team.role === "membre", r);
r = await E("POST", `${teamId}/invitations`, { token: bob, data: { email: "x@y.fr" } });
check("un membre ne peut pas inviter", r.status === 403 && r.body.code === "reserve-proprietaire", r);
r = await E("POST", teamId, { token: bob, data: { name: "Piratage" } });
check("un membre ne peut pas renommer", r.status === 403, r);

const mallory = await login("mallory@ailleurs.fr");
r = await E("GET", teamId, { token: mallory });
check("une personne extérieure ne voit pas l'équipe", r.status === 403 && r.body.code === "pas-membre", r);

const aliceId = (await C("GET", "moi", { token: alice })).body.account.id;
const bobId = (await C("GET", "moi", { token: bob })).body.account.id;
r = await E("DELETE", `${teamId}/membres/${aliceId}`, { token: alice });
check("la dernière propriétaire ne peut pas partir", r.status === 409 && r.body.code === "dernier-proprietaire", r);
r = await C("POST", "supprimer", { token: alice });
check("ni supprimer son compte", r.status === 409 && r.body.code === "seul-proprietaire", r);
r = await E("POST", `${teamId}/membres/${bobId}`, { token: alice, data: { role: "proprietaire" } });
check("Alice nomme Bob propriétaire", r.status === 200, r);
r = await E("DELETE", `${teamId}/membres/${aliceId}`, { token: alice });
check("Alice peut maintenant quitter l'équipe", r.status === 200 && r.body.left, r);
r = await E("GET", teamId, { token: alice });
check("Alice n'a plus accès", r.status === 403, r);

// ---------- Statuts ----------
r = await A("POST", `equipes/${teamId}`, { data: { trialUntil: "2020-01-01T00:00:00Z" } });
check("essai terminé : équipe inactive", r.status === 200 && r.body.team.active === false, r);
r = await A("POST", `equipes/${teamId}`, { data: { status: "actif", trialUntil: null, seats: 5 } });
check("passage en actif", r.body.team.active === true && r.body.team.seats === 5, r);
r = await A("POST", `equipes/${teamId}`, { data: { status: "suspendu" } });
await E("POST", `${teamId}/invitations`, { token: bob, data: { email: "dan@studio.fr" } });
r = await E("POST", `${teamId}/invitations`, { token: bob, data: { email: "dan@studio.fr" } });
check("équipe suspendue : plus d'invitations", r.status === 403 && r.body.code === "equipe-suspendue", r);

r = await A("GET", "equipes");
check("admin : liste et chiffres", r.status === 200 && r.body.stats.teams === 1 && r.body.stats.accounts >= 3, r.body.stats);

// ---------- Déconnexion et suppression ----------
r = await C("POST", "deconnexion", { token: mallory });
r = await C("GET", "moi", { token: mallory });
check("après déconnexion, le jeton ne marche plus", r.status === 401, r);
r = await C("POST", "supprimer", { token: alice });
check("Alice (plus propriétaire de rien) supprime son compte", r.status === 200, r);
r = await C("GET", "moi", { token: alice });
check("compte supprimé : sessions fermées", r.status === 401, r);
r = await A("DELETE", `equipes/${teamId}`);
r = await C("GET", "moi", { token: bob });
check("équipe supprimée par l'admin : Bob n'a plus d'équipe", r.body.teams.length === 0, r);

// ---------- Interrupteur : la section Compte n'apparaît dans l'app qu'une fois tout configuré ----------
const cfg = async (e) => (await config.onRequestGet({ env: e })).json();
check("comptes fermés par défaut", (await cfg({ DB })).comptes === false);
check("comptes fermés sans service d'e-mail", (await cfg({ DB, COMPTES_OUVERTS: "1" })).comptes === false);
check("comptes ouverts quand tout est prêt", (await cfg({ DB, COMPTES_OUVERTS: "1", RESEND_API_KEY: "re_x" })).comptes === true);

// ---------- Production : jamais de code dans la réponse ----------
r = await C("POST", "code", { data: { email: "prod@exemple.fr" }, e: { DB } });
check("sans service d'e-mail en production : erreur claire, pas de code", r.status === 503 && r.body.code === "email-non-configure" && !r.body.devCode, r);

console.log(fails ? `\n${fails} échec(s)` : "\nTout est bon.");
process.exit(fails ? 1 : 0);
