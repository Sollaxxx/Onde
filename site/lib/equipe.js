// Comptes et équipes d'Onde (offre « Onde Équipe », sur demande).
// Connexion sans mot de passe : un code à 6 chiffres envoyé par e-mail, puis un jeton de session
// gardé par l'application. Les équipes sont créées par l'administration d'Onde (forfait, places,
// stockage, essai), puis leurs propriétaires invitent les membres depuis l'application.
//
// Liaison : DB (D1). Variables : RESEND_API_KEY (envoi des e-mails), EMAIL_EXPEDITEUR (facultatif),
// ONDE_DEV=1 seulement en test local (le code est alors renvoyé dans la réponse, jamais en production).
import { json, sha } from "./onde.js";

export const MIN = 60e3;
export const HOUR = 3600e3;
export const DAY = 86400e3;
export const iso = (t = Date.now()) => new Date(t).toISOString();
export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const clip = (v, n) => String(v ?? "").trim().slice(0, n);

/** Forfaits proposés (les places et le stockage restent réglables équipe par équipe). */
export const FORFAITS = {
  studio: { nom: "Studio", places: 5, stockageGo: 10, prixMois: 35 },
  agence: { nom: "Agence", places: 15, stockageGo: 50, prixMois: 89 },
  "sur-mesure": { nom: "Sur mesure", places: 30, stockageGo: 100, prixMois: null },
};
export const STATUTS = new Set(["essai", "actif", "suspendu"]);
export const ROLES = new Set(["proprietaire", "membre"]);

export const CODE_TTL = 10 * MIN;
export const CODE_ESSAIS = 5;
export const SESSION_TTL = 180 * DAY;
export const INVITATION_TTL = 30 * DAY;

// ---------- Messages (français / anglais, selon l'en-tête X-Onde-Langue de l'application) ----------
const MESSAGES = {
  "requete-invalide": ["Requête invalide.", "Invalid request."],
  "base-absente": ["Les comptes ne sont pas encore ouverts.", "Accounts aren't open yet."],
  "email-invalide": ["Adresse e-mail invalide.", "Invalid email address."],
  "trop-de-demandes": ["Trop de demandes. Réessayez dans quelques minutes.", "Too many requests. Try again in a few minutes."],
  "email-non-configure": ["L'envoi d'e-mails n'est pas encore configuré.", "Email sending isn't set up yet."],
  "envoi-impossible": ["L'e-mail n'a pas pu partir. Réessayez dans un instant.", "The email couldn't be sent. Try again in a moment."],
  "code-expire": ["Code expiré. Demandez-en un nouveau.", "This code has expired. Request a new one."],
  "code-incorrect": ["Code incorrect.", "Incorrect code."],
  "trop-d-essais": ["Trop d'essais. Demandez un nouveau code.", "Too many attempts. Request a new code."],
  "non-connecte": ["Session expirée. Reconnectez-vous.", "Your session has expired. Please sign in again."],
  "introuvable": ["Introuvable.", "Not found."],
  "pas-membre": ["Vous ne faites pas partie de cette équipe.", "You're not a member of this team."],
  "reserve-proprietaire": ["Seul un propriétaire de l'équipe peut faire ça.", "Only a team owner can do this."],
  "plus-de-place": ["Plus de place dans le forfait de l'équipe ({places} places). Contactez Onde pour en ajouter.", "No seats left in the team's plan ({places} seats). Contact Onde to add more."],
  "deja-membre": ["Cette personne fait déjà partie de l'équipe.", "This person is already on the team."],
  "deja-invite": ["Cette personne est déjà invitée.", "This person has already been invited."],
  "invitation-expiree": ["Cette invitation a expiré. Demandez-en une nouvelle.", "This invitation has expired. Ask for a new one."],
  "equipe-suspendue": ["Cette équipe est suspendue. Contactez Onde.", "This team is suspended. Contact Onde."],
  "dernier-proprietaire": ["L'équipe doit garder au moins un propriétaire.", "The team must keep at least one owner."],
  "nom-invalide": ["Nom vide ou trop long.", "Name is empty or too long."],
  "equipe-inactive": ["L'essai ou l'abonnement de cette équipe est terminé. Contactez Onde pour la réactiver.", "This team's trial or subscription has ended. Contact Onde to reactivate it."],
  "stockage-absent": ["Le stockage des équipes n'est pas encore configuré.", "Team storage isn't set up yet."],
  "fichier-trop-lourd": ["Fichier trop lourd (100 Mo au maximum).", "File too large (100 MB maximum)."],
  "fichier-vide": ["Fichier vide ou illisible.", "Empty or unreadable file."],
  "format-inconnu": ["Format non reconnu : WAV, AIFF, FLAC, MP3, OGG ou M4A.", "Unsupported format: WAV, AIFF, FLAC, MP3, OGG or M4A."],
  "quota-depasse": ["Le stockage de l'équipe est plein ({gb} Go). Supprimez des sons ou contactez Onde pour en ajouter.", "The team's storage is full ({gb} GB). Delete some sounds or contact Onde to add more."],
  "reserve-auteur": ["Seule la personne qui a ajouté ce son, ou un propriétaire, peut faire ça.", "Only the person who added this sound, or an owner, can do this."],
  "reserve-createur": ["Seule la personne qui a créé cette playlist, ou un propriétaire, peut faire ça.", "Only the person who created this playlist, or an owner, can do this."],
  "trop-de-playlists": ["Trop de playlists dans cette équipe.", "Too many playlists in this team."],
  "lien-expire": ["Lien expiré.", "Link expired."],
  "seul-proprietaire": ["Vous êtes le seul propriétaire d'une équipe. Donnez ce rôle à quelqu'un d'autre avant de supprimer votre compte.", "You're the only owner of a team. Make someone else an owner before deleting your account."],
};

export function langOf(request) {
  return (request.headers.get("X-Onde-Langue") || "").toLowerCase().startsWith("en") ? "en" : "fr";
}

/** Réponse d'erreur : un code stable pour le programme et un message lisible dans la bonne langue. */
export function fail(request, code, status = 400, vars = {}) {
  const [fr, en] = MESSAGES[code] ?? [code, code];
  const text = (langOf(request) === "en" ? en : fr).replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
  return json({ ok: false, code, error: text }, status);
}

// ---------- Base ----------
const ready = new WeakSet();

export async function ensureEquipeTables(db) {
  if (ready.has(db)) return;
  await db.batch([
    db.prepare(`CREATE TABLE IF NOT EXISTS comptes (
      id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT, lang TEXT,
      created_at TEXT NOT NULL, seen_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS codes_connexion (
      email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at TEXT NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS sessions (
      token_hash TEXT PRIMARY KEY, account_id TEXT NOT NULL, device TEXT,
      created_at TEXT NOT NULL, expires_at TEXT NOT NULL, seen_at TEXT)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS equipes (
      id TEXT PRIMARY KEY, name TEXT NOT NULL, plan TEXT NOT NULL, seats INTEGER NOT NULL,
      storage_gb INTEGER NOT NULL, status TEXT NOT NULL, trial_until TEXT, note TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS membres (
      team_id TEXT NOT NULL, account_id TEXT NOT NULL, role TEXT NOT NULL, joined_at TEXT NOT NULL,
      PRIMARY KEY (team_id, account_id))`),
    db.prepare(`CREATE TABLE IF NOT EXISTS invitations (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL, email TEXT NOT NULL, role TEXT NOT NULL,
      invited_by TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL, UNIQUE (team_id, email))`),
    db.prepare("CREATE TABLE IF NOT EXISTS limites (key TEXT PRIMARY KEY, count INTEGER NOT NULL, start TEXT NOT NULL)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS sons_equipe (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL, title TEXT NOT NULL, file_name TEXT NOT NULL, ext TEXT NOT NULL,
      size INTEGER NOT NULL, duration_ms INTEGER, peaks TEXT, tags TEXT, format TEXT, sha TEXT, r2_key TEXT NOT NULL,
      added_by TEXT, created_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS playlists_equipe (
      id TEXT PRIMARY KEY, team_id TEXT NOT NULL, name TEXT NOT NULL, created_by TEXT,
      created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`),
    db.prepare(`CREATE TABLE IF NOT EXISTS playlist_equipe_sons (
      playlist_id TEXT NOT NULL, ref TEXT NOT NULL, position INTEGER NOT NULL, added_by TEXT, added_at TEXT NOT NULL,
      PRIMARY KEY (playlist_id, ref))`),
    db.prepare("CREATE TABLE IF NOT EXISTS equipe_versions (team_id TEXT PRIMARY KEY, version INTEGER NOT NULL)"),
    db.prepare("CREATE TABLE IF NOT EXISTS secrets (key TEXT PRIMARY KEY, value TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sons_equipe_team ON sons_equipe (team_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS playlists_equipe_team ON playlists_equipe (team_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS sessions_compte ON sessions (account_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS membres_compte ON membres (account_id)"),
    db.prepare("CREATE INDEX IF NOT EXISTS invitations_email ON invitations (email)"),
  ]);
  ready.add(db);
}

/** Limite anti-abus : au plus `max` actions par fenêtre de `windowMs` pour une même clé. */
export async function allow(db, key, max, windowMs) {
  const row = await db.prepare("SELECT count, start FROM limites WHERE key = ?1").bind(key).first();
  const t = Date.now();
  if (!row || t - Date.parse(row.start) > windowMs) {
    await db.prepare("INSERT INTO limites (key, count, start) VALUES (?1, 1, ?2) ON CONFLICT (key) DO UPDATE SET count = 1, start = ?2")
      .bind(key, iso(t)).run();
    return true;
  }
  if (row.count >= max) return false;
  await db.prepare("UPDATE limites SET count = count + 1 WHERE key = ?1").bind(key).run();
  return true;
}

export const ipKey = async (request) => (await sha("ip:" + (request.headers.get("CF-Connecting-IP") || ""))).slice(0, 24);

// ---------- Codes et jetons ----------
export function sixDigits() {
  const a = new Uint32Array(1);
  crypto.getRandomValues(a);
  return String(a[0] % 1_000_000).padStart(6, "0");
}

export function newToken() {
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export const codeHash = (email, code) => sha(`code:${email}:${code}`);
export const tokenHash = (token) => sha(`session:${token}`);

export function sameText(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/** Compte connecté d'après l'en-tête « Authorization: Bearer <jeton> », ou null. */
export async function currentAccount(request, env) {
  const m = /^Bearer ([A-Za-z0-9_-]{20,100})$/.exec(request.headers.get("Authorization") || "");
  if (!m) return null;
  const hash = await tokenHash(m[1]);
  const row = await env.DB.prepare(
    `SELECT s.token_hash, s.expires_at, s.seen_at AS session_seen, c.id, c.email, c.name, c.lang
     FROM sessions s JOIN comptes c ON c.id = s.account_id WHERE s.token_hash = ?1`,
  ).bind(hash).first();
  if (!row || Date.parse(row.expires_at) < Date.now()) return null;
  if (!row.session_seen || Date.now() - Date.parse(row.session_seen) > HOUR) {
    await env.DB.batch([
      env.DB.prepare("UPDATE sessions SET seen_at = ?1 WHERE token_hash = ?2").bind(iso(), hash),
      env.DB.prepare("UPDATE comptes SET seen_at = ?1 WHERE id = ?2").bind(iso(), row.id),
    ]);
  }
  return { id: row.id, email: row.email, name: row.name || "", lang: row.lang || "fr", tokenHash: hash };
}

// ---------- Équipes ----------
/** L'équipe peut-elle utiliser Onde Équipe ? (active, ou à l'essai et dans les temps) */
export function teamActive(team) {
  if (team.status === "actif") return true;
  return team.status === "essai" && !!team.trial_until && Date.parse(team.trial_until) > Date.now();
}

/** Places prises : membres + invitations en attente encore valables. */
export async function seatsUsed(db, teamId) {
  const m = await db.prepare("SELECT COUNT(*) AS n FROM membres WHERE team_id = ?1").bind(teamId).first();
  const i = await db.prepare("SELECT COUNT(*) AS n FROM invitations WHERE team_id = ?1 AND expires_at > ?2").bind(teamId, iso()).first();
  return { members: m?.n ?? 0, invitations: i?.n ?? 0 };
}

export function teamView(team, extra = {}) {
  return {
    id: team.id, name: team.name, plan: team.plan, planName: FORFAITS[team.plan]?.nom ?? team.plan,
    seats: team.seats, storageGb: team.storage_gb, status: team.status, trialUntil: team.trial_until || null,
    active: teamActive(team), createdAt: team.created_at, ...extra,
  };
}

export async function teamDetails(db, team) {
  const members = (await db.prepare(
    `SELECT c.id, c.email, c.name, m.role, m.joined_at FROM membres m JOIN comptes c ON c.id = m.account_id
     WHERE m.team_id = ?1 ORDER BY m.role DESC, m.joined_at`,
  ).bind(team.id).all()).results;
  const invitations = (await db.prepare(
    "SELECT id, email, role, created_at, expires_at FROM invitations WHERE team_id = ?1 AND expires_at > ?2 ORDER BY created_at",
  ).bind(team.id, iso()).all()).results;
  return teamView(team, {
    members: members.map((m) => ({ id: m.id, email: m.email, name: m.name || "", role: m.role, joinedAt: m.joined_at })),
    invitations: invitations.map((i) => ({ id: i.id, email: i.email, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at })),
    seatsUsed: members.length + invitations.length,
    storageUsed: await storageUsed(db, team.id),
  });
}

/** Crée (ou renouvelle) une invitation et prévient la personne par e-mail. */
export async function invite(env, team, { email, role, invitedBy, inviterName, lang }) {
  const id = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO invitations (id, team_id, email, role, invited_by, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
     ON CONFLICT (team_id, email) DO UPDATE SET id = ?1, role = ?4, invited_by = ?5, created_at = ?6, expires_at = ?7`,
  ).bind(id, team.id, email, role, invitedBy, iso(), iso(Date.now() + INVITATION_TTL)).run();
  const mail = await sendMail(env, inviteMail(lang, { to: email, team: team.name, inviter: inviterName }));
  return { id, emailSent: mail.ok };
}

// ---------- Contenu partagé (sons et playlists d'équipe) ----------
export const TEAM_FILE_MAX = 100 * 1024 * 1024; // limite des requêtes Cloudflare (offre gratuite)
export const LINK_TTL = 12 * HOUR;

/** Chaque modification du contenu d'une équipe incrémente sa version : les applications savent ainsi s'il faut recharger. */
export async function bumpVersion(db, teamId) {
  await db.prepare("INSERT INTO equipe_versions (team_id, version) VALUES (?1, 1) ON CONFLICT (team_id) DO UPDATE SET version = version + 1")
    .bind(teamId).run();
}

export async function contentVersion(db, teamId) {
  const r = await db.prepare("SELECT version FROM equipe_versions WHERE team_id = ?1").bind(teamId).first();
  return r?.version ?? 0;
}

export async function storageUsed(db, teamId) {
  const r = await db.prepare("SELECT COALESCE(SUM(size), 0) AS n FROM sons_equipe WHERE team_id = ?1").bind(teamId).first();
  return r?.n ?? 0;
}

/** Secret des liens signés : variable LIENS_SECRET, sinon un secret aléatoire créé une fois et gardé dans la base. */
async function linkSecret(env) {
  if (env.LIENS_SECRET) return env.LIENS_SECRET;
  const row = await env.DB.prepare("SELECT value FROM secrets WHERE key = 'liens'").first();
  if (row) return row.value;
  const a = new Uint8Array(32);
  crypto.getRandomValues(a);
  const value = [...a].map((b) => b.toString(16).padStart(2, "0")).join("");
  await env.DB.prepare("INSERT OR IGNORE INTO secrets (key, value) VALUES ('liens', ?1)").bind(value).run();
  return (await env.DB.prepare("SELECT value FROM secrets WHERE key = 'liens'").first()).value;
}

async function hmac(secret, text) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(text));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
}

/** Lien temporaire vers un son d'équipe : lisible sans en-tête (lecteur audio, panneaux), valable 12 h. */
export async function signedUrl(env, origin, sound) {
  const exp = Math.floor((Date.now() + LINK_TTL) / 1000);
  const sig = await hmac(await linkSecret(env), `${sound.team_id}/${sound.id}/${exp}`);
  return `${origin}/api/fichier-equipe/${sound.team_id}/${sound.id}/${exp}/${sig}/${encodeURIComponent(sound.file_name)}`;
}

export async function checkSignature(env, teamId, soundId, exp, sig) {
  if (!/^\d{9,12}$/.test(exp) || Number(exp) * 1000 < Date.now()) return false;
  return sameText(await hmac(await linkSecret(env), `${teamId}/${soundId}/${exp}`), String(sig));
}

export function soundView(row) {
  let peaks = [];
  let tags = [];
  try { peaks = JSON.parse(row.peaks || "[]"); } catch { /* ignoré */ }
  try { tags = JSON.parse(row.tags || "[]"); } catch { /* ignoré */ }
  return {
    id: row.id, title: row.title, fileName: row.file_name, size: row.size, durationMs: row.duration_ms ?? 0,
    peaks, tags, format: row.format || row.ext.toUpperCase(), addedBy: row.added_by, addedByName: row.added_by_name || "",
    createdAt: row.created_at,
  };
}

// ---------- E-mails ----------
export async function sendMail(env, { to, subject, text, html }) {
  if (!env.RESEND_API_KEY) {
    if (env.ONDE_DEV === "1") return { ok: true, dev: true };
    return { ok: false, error: "email-non-configure" };
  }
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_EXPEDITEUR || "Onde <compte@ondesound.com>", to: [to], subject, text, html }),
    });
    return r.ok ? { ok: true } : { ok: false, error: `resend-${r.status}` };
  } catch {
    return { ok: false, error: "envoi-impossible" };
  }
}

const escHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function frame(title, body) {
  return `<!doctype html><html><body style="margin:0;background:#fbfbf9;font-family:Helvetica,Arial,sans-serif;color:#0d0d0f">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="480" cellpadding="0" cellspacing="0" style="max-width:480px;background:#ffffff;border:1px solid #e6e6e2">
<tr><td style="background:#002fa7;color:#ffffff;padding:18px 24px;font-weight:bold;font-size:20px;letter-spacing:-0.5px">Onde</td></tr>
<tr><td style="padding:28px 24px"><h1 style="margin:0 0 16px;font-size:22px">${escHtml(title)}</h1>${body}</td></tr>
<tr><td style="padding:16px 24px;border-top:1px solid #e6e6e2;color:#66666d;font-size:12px">ondesound.com</td></tr>
</table></td></tr></table></body></html>`;
}

export function codeMail(lang, { to, code }) {
  const en = lang === "en";
  const title = en ? "Your Onde sign-in code" : "Votre code de connexion Onde";
  const line = en ? "Enter this code in Onde to sign in. It expires in 10 minutes." : "Tapez ce code dans Onde pour vous connecter. Il expire dans 10 minutes.";
  const ignore = en ? "If you didn't ask for it, you can ignore this email." : "Si vous n'avez rien demandé, ignorez simplement cet e-mail.";
  return {
    to,
    subject: en ? `${code} is your Onde code` : `${code} est votre code Onde`,
    text: `${line}\n\n${code}\n\n${ignore}`,
    html: frame(title, `<p style="margin:0 0 20px;line-height:1.5">${line}</p>
<p style="margin:0 0 20px;font-family:Menlo,Consolas,monospace;font-size:34px;letter-spacing:8px;font-weight:bold;color:#002fa7">${code}</p>
<p style="margin:0;color:#66666d;font-size:13px">${ignore}</p>`),
  };
}

export function inviteMail(lang, { to, team, inviter }) {
  const en = lang === "en";
  const who = inviter ? escHtml(inviter) : en ? "Someone" : "Quelqu'un";
  const title = en ? `Join ${team} on Onde` : `Rejoignez ${team} sur Onde`;
  const line = en
    ? `${who} invited you to the team <b>${escHtml(team)}</b> on Onde. Open Onde, go to Settings, then Account, and sign in with this email address to join.`
    : `${who} vous invite dans l'équipe <b>${escHtml(team)}</b> sur Onde. Ouvrez Onde, allez dans Réglages, puis Compte, et connectez-vous avec cette adresse pour la rejoindre.`;
  const get = en ? "Don't have Onde yet? It's free on ondesound.com." : "Vous n'avez pas encore Onde ? Il est gratuit sur ondesound.com.";
  const plain = line.replace(/<\/?b>/g, "");
  return {
    to,
    subject: title,
    text: `${plain}\n\n${get}`,
    html: frame(title, `<p style="margin:0 0 20px;line-height:1.5">${line}</p>
<p style="margin:0"><a href="https://ondesound.com" style="display:inline-block;background:#002fa7;color:#ffffff;padding:12px 18px;text-decoration:none;font-weight:bold">ondesound.com</a></p>
<p style="margin:20px 0 0;color:#66666d;font-size:13px">${get}</p>`),
  };
}

// ---------- Petit routeur pour les fonctions [[chemin]] ----------
/**
 * routes : [méthode, motif, gestionnaire] ; le motif est une liste de segments, « :nom » pour un paramètre.
 * Le gestionnaire reçoit (ctx, params).
 */
export async function route(ctx, routes) {
  const segs = [].concat(ctx.params?.chemin ?? []).filter(Boolean);
  const method = ctx.request.method;
  let pathMatched = false;
  for (const [m, pattern, handler] of routes) {
    if (pattern.length !== segs.length) continue;
    const params = {};
    if (!pattern.every((p, i) => (p.startsWith(":") ? ((params[p.slice(1)] = decodeURIComponent(segs[i])), true) : p === segs[i]))) continue;
    pathMatched = true;
    if (m === method) return handler(ctx, params);
  }
  return pathMatched ? json({ ok: false, error: "method not allowed" }, 405) : fail(ctx.request, "introuvable", 404);
}

export async function body(request) {
  try { return await request.json(); } catch { return null; }
}
