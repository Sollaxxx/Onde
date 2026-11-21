// Gestion d'une équipe par ses membres : /api/equipe/…
//   GET    :id                              → l'équipe, ses membres et ses invitations (membres seulement)
//   POST   :id                  { name }    → renommer (propriétaire)
//   POST   :id/invitations      { email, role? } → inviter (propriétaire, dans la limite des places)
//   DELETE :id/invitations/:inv             → annuler une invitation (propriétaire)
//   DELETE :id/membres/:compte              → retirer un membre (propriétaire) ou quitter l'équipe (soi-même)
//   POST   :id/membres/:compte  { role }    → changer le rôle (propriétaire)
// Contenu partagé (équipe active seulement : essai en cours ou abonnement payé) :
//   GET    :id/contenu?v=N                  → sons (avec liens temporaires) et playlists ; { unchanged } si la version n'a pas bougé
//   POST   :id/sons                         → envoyer un son (corps = fichier, en-tête X-Onde-Meta = JSON encodé)
//   POST   :id/sons/:son        { title?, tags? } → renommer (auteur du son ou propriétaire)
//   DELETE :id/sons/:son                    → supprimer (auteur du son ou propriétaire)
//   POST   :id/playlists        { name }    → créer une playlist partagée
//   POST   :id/playlists/:pl    { name }    → renommer (créateur ou propriétaire)
//   DELETE :id/playlists/:pl                → supprimer (créateur ou propriétaire)
//   POST   :id/playlists/:pl/sons { ref }   → ajouter un son (de la banque ou de l'équipe)
//   DELETE :id/playlists/:pl/sons/:ref      → retirer un son
import { json } from "../../../lib/onde.js";
import { audioKind } from "../../../lib/onde.js";
import {
  DAY, EMAIL, ROLES, TEAM_FILE_MAX, allow, body, bumpVersion, clip, contentVersion, currentAccount, ensureEquipeTables, fail, invite,
  iso, langOf, route, seatsUsed, signedUrl, soundView, storageUsed, teamActive, teamDetails,
} from "../../../lib/equipe.js";

export async function onRequest(ctx) {
  if (!ctx.env.DB) return fail(ctx.request, "base-absente", 503);
  await ensureEquipeTables(ctx.env.DB);
  const account = await currentAccount(ctx.request, ctx.env);
  if (!account) return fail(ctx.request, "non-connecte", 401);
  ctx.account = account;
  return route(ctx, ROUTES);
}

const ROUTES = [
  ["GET", [":id"], membre(voir)],
  ["POST", [":id"], proprietaire(renommer)],
  ["POST", [":id", "invitations"], proprietaire(inviter)],
  ["DELETE", [":id", "invitations", ":inv"], proprietaire(annulerInvitation)],
  ["DELETE", [":id", "membres", ":compte"], membre(retirer)],
  ["POST", [":id", "membres", ":compte"], proprietaire(changerRole)],
  ["GET", [":id", "contenu"], actif(contenu)],
  ["POST", [":id", "sons"], actif(envoyerSon)],
  ["POST", [":id", "sons", ":son"], actif(modifierSon)],
  ["DELETE", [":id", "sons", ":son"], actif(supprimerSon)],
  ["POST", [":id", "playlists"], actif(creerPlaylist)],
  ["POST", [":id", "playlists", ":pl"], actif(renommerPlaylist)],
  ["DELETE", [":id", "playlists", ":pl"], actif(supprimerPlaylist)],
  ["POST", [":id", "playlists", ":pl", "sons"], actif(ajouterAPlaylist)],
  ["DELETE", [":id", "playlists", ":pl", "sons", ":ref"], actif(retirerDePlaylist)],
];

/** Charge l'équipe et le rôle du compte connecté ; refuse si ce n'est pas un membre. */
function membre(handler) {
  return async (ctx, params) => {
    const team = await ctx.env.DB.prepare(
      "SELECT e.*, m.role FROM equipes e JOIN membres m ON m.team_id = e.id AND m.account_id = ?1 WHERE e.id = ?2",
    ).bind(ctx.account.id, params.id).first();
    if (!team) return fail(ctx.request, "pas-membre", 403);
    return handler(ctx, params, team);
  };
}

/** Contenu partagé : réservé aux membres d'une équipe active (essai en cours ou abonnement payé). */
function actif(handler) {
  return membre((ctx, params, team) => (teamActive(team) ? handler(ctx, params, team) : fail(ctx.request, "equipe-inactive", 403)));
}

function proprietaire(handler) {
  return membre((ctx, params, team) => (team.role === "proprietaire" ? handler(ctx, params, team) : fail(ctx.request, "reserve-proprietaire", 403)));
}

async function owners(db, teamId) {
  const r = await db.prepare("SELECT COUNT(*) AS n FROM membres WHERE team_id = ?1 AND role = 'proprietaire'").bind(teamId).first();
  return r?.n ?? 0;
}

async function voir({ env }, _p, team) {
  return json({ ok: true, team: { ...(await teamDetails(env.DB, team)), role: team.role } });
}

async function renommer({ request, env }, _p, team) {
  const name = clip((await body(request))?.name, 60);
  if (name.length < 2) return fail(request, "nom-invalide");
  await env.DB.prepare("UPDATE equipes SET name = ?1 WHERE id = ?2").bind(name, team.id).run();
  return voir({ env }, null, { ...team, name });
}

async function inviter({ request, env, account }, _p, team) {
  if (team.status === "suspendu") return fail(request, "equipe-suspendue", 403);
  const b = await body(request);
  const email = clip(b?.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return fail(request, "email-invalide");
  const role = ROLES.has(b?.role) ? b.role : "membre";
  const isMember = await env.DB.prepare(
    "SELECT 1 FROM membres m JOIN comptes c ON c.id = m.account_id WHERE m.team_id = ?1 AND c.email = ?2",
  ).bind(team.id, email).first();
  if (isMember) return fail(request, "deja-membre", 409);
  const pending = await env.DB.prepare("SELECT 1 FROM invitations WHERE team_id = ?1 AND email = ?2 AND expires_at > ?3")
    .bind(team.id, email, new Date().toISOString()).first();
  // Une invitation déjà en attente peut être renvoyée sans prendre de place de plus.
  if (!pending) {
    const used = await seatsUsed(env.DB, team.id);
    if (used.members + used.invitations >= team.seats) return fail(request, "plus-de-place", 409, { places: team.seats });
  }
  if (!(await allow(env.DB, `invitations:${team.id}`, 50, DAY))) return fail(request, "trop-de-demandes", 429);
  const res = await invite(env, team, { email, role, invitedBy: account.id, inviterName: account.name || account.email, lang: langOf(request) });
  return json({ ok: true, invitation: { id: res.id, email, role }, emailSent: res.emailSent, resent: !!pending });
}

async function annulerInvitation({ request, env }, { inv }, team) {
  const r = await env.DB.prepare("SELECT 1 FROM invitations WHERE id = ?1 AND team_id = ?2").bind(inv, team.id).first();
  if (!r) return fail(request, "introuvable", 404);
  await env.DB.prepare("DELETE FROM invitations WHERE id = ?1").bind(inv).run();
  return json({ ok: true });
}

async function retirer({ request, env, account }, { compte }, team) {
  const self = compte === account.id;
  if (!self && team.role !== "proprietaire") return fail(request, "reserve-proprietaire", 403);
  const target = await env.DB.prepare("SELECT role FROM membres WHERE team_id = ?1 AND account_id = ?2").bind(team.id, compte).first();
  if (!target) return fail(request, "introuvable", 404);
  if (target.role === "proprietaire" && (await owners(env.DB, team.id)) <= 1) return fail(request, "dernier-proprietaire", 409);
  await env.DB.prepare("DELETE FROM membres WHERE team_id = ?1 AND account_id = ?2").bind(team.id, compte).run();
  return json({ ok: true, left: self });
}

async function changerRole({ request, env }, { compte }, team) {
  const role = (await body(request))?.role;
  if (!ROLES.has(role)) return fail(request, "requete-invalide");
  const target = await env.DB.prepare("SELECT role FROM membres WHERE team_id = ?1 AND account_id = ?2").bind(team.id, compte).first();
  if (!target) return fail(request, "introuvable", 404);
  if (target.role === "proprietaire" && role !== "proprietaire" && (await owners(env.DB, team.id)) <= 1) {
    return fail(request, "dernier-proprietaire", 409);
  }
  await env.DB.prepare("UPDATE membres SET role = ?1 WHERE team_id = ?2 AND account_id = ?3").bind(role, team.id, compte).run();
  return json({ ok: true });
}

// ---------- Contenu partagé ----------
const REF = /^[A-Za-z0-9_.:-]{1,80}$/;

async function contenu({ request, env }, _p, team) {
  const v = Number(new URL(request.url).searchParams.get("v") ?? -1);
  const version = await contentVersion(env.DB, team.id);
  if (v === version) return json({ ok: true, unchanged: true, version });
  const origin = new URL(request.url).origin;
  const rows = (await env.DB.prepare(
    `SELECT s.*, c.name AS added_by_name FROM sons_equipe s LEFT JOIN comptes c ON c.id = s.added_by
     WHERE s.team_id = ?1 ORDER BY s.created_at DESC`,
  ).bind(team.id).all()).results;
  const sounds = [];
  for (const r of rows) sounds.push({ ...soundView(r), url: await signedUrl(env, origin, r) });
  const lists = (await env.DB.prepare("SELECT * FROM playlists_equipe WHERE team_id = ?1 ORDER BY created_at").bind(team.id).all()).results;
  const items = (await env.DB.prepare(
    `SELECT i.playlist_id, i.ref FROM playlist_equipe_sons i JOIN playlists_equipe p ON p.id = i.playlist_id
     WHERE p.team_id = ?1 ORDER BY i.position`,
  ).bind(team.id).all()).results;
  const playlists = lists.map((p) => ({
    id: p.id, name: p.name, createdBy: p.created_by, updatedAt: p.updated_at,
    ids: items.filter((i) => i.playlist_id === p.id).map((i) => i.ref),
  }));
  return json({
    ok: true, version, storageUsed: rows.reduce((n, r) => n + r.size, 0), storageGb: team.storage_gb, sounds, playlists,
    linksExpireAt: iso(Date.now() + 11 * 3600e3),
  });
}

async function envoyerSon({ request, env, account }, _p, team) {
  if (!env.EQUIPES) return fail(request, "stockage-absent", 503);
  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > TEAM_FILE_MAX) return fail(request, "fichier-trop-lourd", 413);
  let meta;
  try { meta = JSON.parse(decodeURIComponent(request.headers.get("X-Onde-Meta") || "")); } catch { return fail(request, "requete-invalide"); }
  if (!(await allow(env.DB, `envois:${team.id}`, 2000, DAY))) return fail(request, "trop-de-demandes", 429);
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > TEAM_FILE_MAX) return fail(request, "fichier-trop-lourd", 413);
  if (bytes.byteLength < 100) return fail(request, "fichier-vide");
  const kind = audioKind(bytes);
  if (!kind) return fail(request, "format-inconnu", 415);

  // Le même fichier envoyé deux fois (par deux membres, par exemple) n'occupe qu'une place.
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha = [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
  const twin = await env.DB.prepare("SELECT * FROM sons_equipe WHERE team_id = ?1 AND sha = ?2").bind(team.id, sha).first();
  if (twin) return json({ ok: true, duplicate: true, sound: soundView(twin) });

  const used = await storageUsed(env.DB, team.id);
  if (used + bytes.byteLength > team.storage_gb * 1024 ** 3) return fail(request, "quota-depasse", 413, { gb: team.storage_gb });

  const id = crypto.randomUUID();
  const peaks = (Array.isArray(meta.peaks) ? meta.peaks : []).slice(0, 200).map((x) => Math.max(0, Math.min(1, Math.round(Number(x) * 1000) / 1000 || 0)));
  const tags = (Array.isArray(meta.tags) ? meta.tags : []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 12);
  const fileName = clip(meta.fileName, 120).replace(/[\\/:*?"<>|]+/g, "_") || `son.${kind.ext}`;
  const row = {
    id, team_id: team.id, title: clip(meta.title, 100) || fileName.replace(/\.[^.]+$/, ""), file_name: fileName, ext: kind.ext,
    size: bytes.byteLength, duration_ms: Math.max(0, Math.round(Number(meta.durationMs) || 0)), peaks: JSON.stringify(peaks),
    tags: JSON.stringify(tags), format: clip(meta.format, 60) || kind.ext.toUpperCase(), sha, r2_key: `equipes/${team.id}/${id}.${kind.ext}`,
    added_by: account.id, created_at: iso(),
  };
  await env.EQUIPES.put(row.r2_key, bytes, { httpMetadata: { contentType: kind.type } });
  await env.DB.prepare(
    `INSERT INTO sons_equipe (id, team_id, title, file_name, ext, size, duration_ms, peaks, tags, format, sha, r2_key, added_by, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)`,
  ).bind(row.id, row.team_id, row.title, row.file_name, row.ext, row.size, row.duration_ms, row.peaks, row.tags, row.format, row.sha, row.r2_key, row.added_by, row.created_at).run();
  await bumpVersion(env.DB, team.id);
  return json({ ok: true, sound: { ...soundView(row), addedByName: account.name } });
}

/** Le son, si le compte peut le modifier (l'auteur ou un propriétaire). */
async function ownSound(ctx, team, id) {
  const row = await ctx.env.DB.prepare("SELECT * FROM sons_equipe WHERE id = ?1 AND team_id = ?2").bind(id, team.id).first();
  if (!row) return { error: fail(ctx.request, "introuvable", 404) };
  if (row.added_by !== ctx.account.id && team.role !== "proprietaire") return { error: fail(ctx.request, "reserve-auteur", 403) };
  return { row };
}

async function modifierSon(ctx, { son }, team) {
  const { row, error } = await ownSound(ctx, team, son);
  if (error) return error;
  const b = await body(ctx.request);
  if (!b) return fail(ctx.request, "requete-invalide");
  const title = b.title === undefined ? row.title : clip(b.title, 100);
  if (!title) return fail(ctx.request, "nom-invalide");
  const tags = Array.isArray(b.tags) ? JSON.stringify(b.tags.map((t) => clip(t, 30)).filter(Boolean).slice(0, 12)) : row.tags;
  await ctx.env.DB.prepare("UPDATE sons_equipe SET title = ?1, tags = ?2 WHERE id = ?3").bind(title, tags, row.id).run();
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true, sound: soundView({ ...row, title, tags }) });
}

async function supprimerSon(ctx, { son }, team) {
  const { row, error } = await ownSound(ctx, team, son);
  if (error) return error;
  if (ctx.env.EQUIPES) await ctx.env.EQUIPES.delete(row.r2_key);
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM sons_equipe WHERE id = ?1").bind(row.id),
    ctx.env.DB.prepare("DELETE FROM playlist_equipe_sons WHERE ref = ?1 AND playlist_id IN (SELECT id FROM playlists_equipe WHERE team_id = ?2)").bind(`eq-${row.id}`, team.id),
  ]);
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true });
}

async function creerPlaylist({ request, env, account }, _p, team) {
  const name = clip((await body(request))?.name, 60);
  if (name.length < 1) return fail(request, "nom-invalide");
  const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM playlists_equipe WHERE team_id = ?1").bind(team.id).first();
  if ((n?.n ?? 0) >= 300) return fail(request, "trop-de-playlists", 409);
  const p = { id: crypto.randomUUID(), name, created_by: account.id, created_at: iso() };
  await env.DB.prepare("INSERT INTO playlists_equipe (id, team_id, name, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)")
    .bind(p.id, team.id, p.name, p.created_by, p.created_at).run();
  await bumpVersion(env.DB, team.id);
  return json({ ok: true, playlist: { id: p.id, name, createdBy: account.id, updatedAt: p.created_at, ids: [] } });
}

async function findPlaylist(ctx, team, id, mustOwn) {
  const p = await ctx.env.DB.prepare("SELECT * FROM playlists_equipe WHERE id = ?1 AND team_id = ?2").bind(id, team.id).first();
  if (!p) return { error: fail(ctx.request, "introuvable", 404) };
  if (mustOwn && p.created_by !== ctx.account.id && team.role !== "proprietaire") return { error: fail(ctx.request, "reserve-createur", 403) };
  return { p };
}

async function renommerPlaylist(ctx, { pl }, team) {
  const { p, error } = await findPlaylist(ctx, team, pl, true);
  if (error) return error;
  const name = clip((await body(ctx.request))?.name, 60);
  if (!name) return fail(ctx.request, "nom-invalide");
  await ctx.env.DB.prepare("UPDATE playlists_equipe SET name = ?1, updated_at = ?2 WHERE id = ?3").bind(name, iso(), p.id).run();
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true });
}

async function supprimerPlaylist(ctx, { pl }, team) {
  const { p, error } = await findPlaylist(ctx, team, pl, true);
  if (error) return error;
  await ctx.env.DB.batch([
    ctx.env.DB.prepare("DELETE FROM playlist_equipe_sons WHERE playlist_id = ?1").bind(p.id),
    ctx.env.DB.prepare("DELETE FROM playlists_equipe WHERE id = ?1").bind(p.id),
  ]);
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true });
}

async function ajouterAPlaylist(ctx, { pl }, team) {
  const { p, error } = await findPlaylist(ctx, team, pl, false);
  if (error) return error;
  const ref = clip((await body(ctx.request))?.ref, 80);
  if (!REF.test(ref)) return fail(ctx.request, "requete-invalide");
  if (ref.startsWith("eq-")) {
    const own = await ctx.env.DB.prepare("SELECT 1 FROM sons_equipe WHERE id = ?1 AND team_id = ?2").bind(ref.slice(3), team.id).first();
    if (!own) return fail(ctx.request, "introuvable", 404);
  }
  const n = await ctx.env.DB.prepare("SELECT COUNT(*) AS n, COALESCE(MAX(position), 0) AS last FROM playlist_equipe_sons WHERE playlist_id = ?1").bind(p.id).first();
  if ((n?.n ?? 0) >= 3000) return fail(ctx.request, "trop-de-demandes", 409);
  await ctx.env.DB.prepare("INSERT OR IGNORE INTO playlist_equipe_sons (playlist_id, ref, position, added_by, added_at) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(p.id, ref, (n?.last ?? 0) + 1, ctx.account.id, iso()).run();
  await ctx.env.DB.prepare("UPDATE playlists_equipe SET updated_at = ?1 WHERE id = ?2").bind(iso(), p.id).run();
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true });
}

async function retirerDePlaylist(ctx, { pl, ref }, team) {
  const { p, error } = await findPlaylist(ctx, team, pl, false);
  if (error) return error;
  await ctx.env.DB.prepare("DELETE FROM playlist_equipe_sons WHERE playlist_id = ?1 AND ref = ?2").bind(p.id, ref).run();
  await ctx.env.DB.prepare("UPDATE playlists_equipe SET updated_at = ?1 WHERE id = ?2").bind(iso(), p.id).run();
  await bumpVersion(ctx.env.DB, team.id);
  return json({ ok: true });
}
