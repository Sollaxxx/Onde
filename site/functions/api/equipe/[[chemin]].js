// Gestion d'une équipe par ses membres : /api/equipe/…
//   GET    :id                              → l'équipe, ses membres et ses invitations (membres seulement)
//   POST   :id                  { name }    → renommer (propriétaire)
//   POST   :id/invitations      { email, role? } → inviter (propriétaire, dans la limite des places)
//   DELETE :id/invitations/:inv             → annuler une invitation (propriétaire)
//   DELETE :id/membres/:compte              → retirer un membre (propriétaire) ou quitter l'équipe (soi-même)
//   POST   :id/membres/:compte  { role }    → changer le rôle (propriétaire)
import { json } from "../../../lib/onde.js";
import {
  DAY, EMAIL, ROLES, allow, body, clip, currentAccount, ensureEquipeTables, fail, invite, langOf, route, seatsUsed, teamDetails,
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
