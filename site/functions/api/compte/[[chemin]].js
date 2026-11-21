// Comptes Onde : /api/compte/…
//   POST code                         { email, lang }           → envoie un code à 6 chiffres par e-mail
//   POST connexion                    { email, code, device }   → { token, account }
//   GET  moi                                                    → compte, équipes, invitations reçues
//   POST moi                          { name?, lang? }          → met à jour le profil
//   POST deconnexion                                            → ferme cette session
//   POST supprimer                                              → supprime le compte (RGPD)
//   POST invitations/:id/accepter | invitations/:id/refuser
// Authentification : « Authorization: Bearer <jeton> » (sauf code et connexion).
import { json } from "../../../lib/onde.js";
import {
  CODE_ESSAIS, CODE_TTL, EMAIL, HOUR, SESSION_TTL, allow, body, clip, codeHash, codeMail, currentAccount, ensureEquipeTables,
  fail, iso, ipKey, langOf, newToken, route, sameText, sendMail, sixDigits, teamView, tokenHash,
} from "../../../lib/equipe.js";

export async function onRequest(ctx) {
  if (!ctx.env.DB) return fail(ctx.request, "base-absente", 503);
  await ensureEquipeTables(ctx.env.DB);
  return route(ctx, ROUTES);
}

const ROUTES = [
  ["POST", ["code"], demanderCode],
  ["POST", ["connexion"], connexion],
  ["GET", ["moi"], connecte(moi)],
  ["POST", ["moi"], connecte(majProfil)],
  ["POST", ["deconnexion"], connecte(deconnexion)],
  ["POST", ["supprimer"], connecte(supprimer)],
  ["POST", ["invitations", ":id", "accepter"], connecte(accepter)],
  ["POST", ["invitations", ":id", "refuser"], connecte(refuser)],
];

/** Réserve une route aux comptes connectés. */
function connecte(handler) {
  return async (ctx, params) => {
    const account = await currentAccount(ctx.request, ctx.env);
    if (!account) return fail(ctx.request, "non-connecte", 401);
    return handler(ctx, params, account);
  };
}

async function demanderCode({ request, env }) {
  const b = await body(request);
  const email = clip(b?.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return fail(request, "email-invalide");
  const lang = b?.lang === "en" || b?.lang === "fr" ? b.lang : langOf(request);
  const ip = await ipKey(request);
  if (!(await allow(env.DB, `code:${email}`, 5, HOUR)) || !(await allow(env.DB, `code-ip:${ip}`, 20, HOUR))) {
    return fail(request, "trop-de-demandes", 429);
  }
  const code = sixDigits();
  await env.DB.prepare(
    `INSERT INTO codes_connexion (email, code_hash, expires_at, attempts, created_at) VALUES (?1, ?2, ?3, 0, ?4)
     ON CONFLICT (email) DO UPDATE SET code_hash = ?2, expires_at = ?3, attempts = 0, created_at = ?4`,
  ).bind(email, await codeHash(email, code), iso(Date.now() + CODE_TTL), iso()).run();
  const mail = await sendMail(env, codeMail(lang, { to: email, code }));
  if (!mail.ok) return fail(request, mail.error === "email-non-configure" ? "email-non-configure" : "envoi-impossible", 503);
  // En test local seulement (ONDE_DEV=1, sans service d'e-mail), le code est renvoyé pour pouvoir se connecter.
  return json({ ok: true, ...(mail.dev ? { devCode: code } : {}) });
}

async function connexion({ request, env }) {
  const b = await body(request);
  const email = clip(b?.email, 254).toLowerCase();
  const code = clip(b?.code, 12).replace(/\D/g, "");
  if (!EMAIL.test(email) || code.length !== 6) return fail(request, "code-incorrect");
  if (!(await allow(env.DB, `connexion-ip:${await ipKey(request)}`, 60, HOUR))) return fail(request, "trop-de-demandes", 429);

  const row = await env.DB.prepare("SELECT * FROM codes_connexion WHERE email = ?1").bind(email).first();
  const forget = () => env.DB.prepare("DELETE FROM codes_connexion WHERE email = ?1").bind(email).run();
  if (!row || Date.parse(row.expires_at) < Date.now()) {
    if (row) await forget();
    return fail(request, "code-expire");
  }
  if (!sameText(await codeHash(email, code), row.code_hash)) {
    if (row.attempts + 1 >= CODE_ESSAIS) {
      await forget();
      return fail(request, "trop-d-essais", 429);
    }
    await env.DB.prepare("UPDATE codes_connexion SET attempts = attempts + 1 WHERE email = ?1").bind(email).run();
    return fail(request, "code-incorrect");
  }
  await forget();

  let account = await env.DB.prepare("SELECT id, email, name, lang FROM comptes WHERE email = ?1").bind(email).first();
  if (!account) {
    account = { id: crypto.randomUUID(), email, name: "", lang: langOf(request) };
    await env.DB.prepare("INSERT INTO comptes (id, email, name, lang, created_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)")
      .bind(account.id, email, "", account.lang, iso()).run();
  }
  const token = newToken();
  await env.DB.prepare("INSERT INTO sessions (token_hash, account_id, device, created_at, expires_at, seen_at) VALUES (?1, ?2, ?3, ?4, ?5, ?4)")
    .bind(await tokenHash(token), account.id, clip(b?.device, 80), iso(), iso(Date.now() + SESSION_TTL)).run();
  return json({ ok: true, token, account: { id: account.id, email: account.email, name: account.name || "" } });
}

async function moi({ env }, _p, account) {
  const teams = (await env.DB.prepare(
    "SELECT e.*, m.role FROM membres m JOIN equipes e ON e.id = m.team_id WHERE m.account_id = ?1 ORDER BY e.name",
  ).bind(account.id).all()).results;
  const invitations = (await env.DB.prepare(
    `SELECT i.id, i.role, i.created_at, i.expires_at, e.id AS team_id, e.name AS team_name, c.name AS inviter_name, c.email AS inviter_email
     FROM invitations i JOIN equipes e ON e.id = i.team_id LEFT JOIN comptes c ON c.id = i.invited_by
     WHERE i.email = ?1 AND i.expires_at > ?2 ORDER BY i.created_at`,
  ).bind(account.email, iso()).all()).results;
  return json({
    ok: true,
    account: { id: account.id, email: account.email, name: account.name, lang: account.lang },
    teams: teams.map((t) => teamView(t, { role: t.role })),
    invitations: invitations.map((i) => ({
      id: i.id, role: i.role, createdAt: i.created_at, expiresAt: i.expires_at,
      team: { id: i.team_id, name: i.team_name }, invitedBy: i.inviter_name || i.inviter_email || null,
    })),
  });
}

async function majProfil({ request, env }, _p, account) {
  const b = await body(request);
  if (!b) return fail(request, "requete-invalide");
  const name = b.name === undefined ? account.name : clip(b.name, 60);
  const lang = b.lang === "en" || b.lang === "fr" ? b.lang : account.lang;
  await env.DB.prepare("UPDATE comptes SET name = ?1, lang = ?2 WHERE id = ?3").bind(name, lang, account.id).run();
  return json({ ok: true, account: { id: account.id, email: account.email, name, lang } });
}

async function deconnexion({ env }, _p, account) {
  await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?1").bind(account.tokenHash).run();
  return json({ ok: true });
}

async function supprimer({ request, env }, _p, account) {
  // Refus si le compte est le seul propriétaire d'une équipe : elle resterait sans personne pour la gérer.
  const owned = (await env.DB.prepare("SELECT team_id FROM membres WHERE account_id = ?1 AND role = 'proprietaire'").bind(account.id).all()).results;
  for (const { team_id } of owned) {
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM membres WHERE team_id = ?1 AND role = 'proprietaire'").bind(team_id).first();
    if ((n?.n ?? 0) <= 1) return fail(request, "seul-proprietaire", 409);
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM membres WHERE account_id = ?1").bind(account.id),
    env.DB.prepare("DELETE FROM sessions WHERE account_id = ?1").bind(account.id),
    env.DB.prepare("DELETE FROM invitations WHERE email = ?1").bind(account.email),
    env.DB.prepare("UPDATE invitations SET invited_by = NULL WHERE invited_by = ?1").bind(account.id),
    env.DB.prepare("DELETE FROM codes_connexion WHERE email = ?1").bind(account.email),
    env.DB.prepare("DELETE FROM comptes WHERE id = ?1").bind(account.id),
  ]);
  return json({ ok: true });
}

async function accepter({ request, env }, { id }, account) {
  const inv = await env.DB.prepare("SELECT * FROM invitations WHERE id = ?1").bind(id).first();
  if (!inv || inv.email !== account.email) return fail(request, "introuvable", 404);
  const drop = () => env.DB.prepare("DELETE FROM invitations WHERE id = ?1").bind(id).run();
  if (Date.parse(inv.expires_at) < Date.now()) {
    await drop();
    return fail(request, "invitation-expiree", 410);
  }
  const team = await env.DB.prepare("SELECT * FROM equipes WHERE id = ?1").bind(inv.team_id).first();
  if (!team) {
    await drop();
    return fail(request, "introuvable", 404);
  }
  if (team.status === "suspendu") return fail(request, "equipe-suspendue", 403);
  const already = await env.DB.prepare("SELECT role FROM membres WHERE team_id = ?1 AND account_id = ?2").bind(team.id, account.id).first();
  if (!already) {
    // L'invitation occupait déjà une place : on vérifie seulement qu'il en reste une pour le nouveau membre.
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM membres WHERE team_id = ?1").bind(team.id).first();
    if ((n?.n ?? 0) >= team.seats) return fail(request, "plus-de-place", 409, { places: team.seats });
    await env.DB.prepare("INSERT INTO membres (team_id, account_id, role, joined_at) VALUES (?1, ?2, ?3, ?4)")
      .bind(team.id, account.id, inv.role, iso()).run();
  }
  await drop();
  return json({ ok: true, team: teamView(team, { role: already?.role ?? inv.role }) });
}

async function refuser({ request, env }, { id }, account) {
  const inv = await env.DB.prepare("SELECT email FROM invitations WHERE id = ?1").bind(id).first();
  if (!inv || inv.email !== account.email) return fail(request, "introuvable", 404);
  await env.DB.prepare("DELETE FROM invitations WHERE id = ?1").bind(id).run();
  return json({ ok: true });
}
