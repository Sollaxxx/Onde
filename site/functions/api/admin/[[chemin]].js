// Administration d'Onde Équipe (réservée à l'équipe Onde, mot de passe ADMIN_MOT_DE_PASSE) : /api/admin/…
//   GET    equipes                                   → toutes les équipes + chiffres
//   POST   equipes      { name, plan, seats?, storageGb?, status, trialDays?, ownerEmail, note?, lang? }
//   GET    equipes/:id                               → détail (membres, invitations, note)
//   POST   equipes/:id  { name?, plan?, seats?, storageGb?, status?, trialUntil?, note? }
//   DELETE equipes/:id                               → supprimer l'équipe
//   POST   equipes/:id/invitations   { email, role? } (sans limite de places : c'est l'administration)
//   DELETE equipes/:id/invitations/:inv
//   DELETE equipes/:id/membres/:compte
//   POST   equipes/:id/membres/:compte { role }
import { checkAdmin, json } from "../../../lib/onde.js";
import {
  DAY, EMAIL, FORFAITS, ROLES, STATUTS, body, clip, ensureEquipeTables, fail, iso, invite, route, teamDetails, teamView,
} from "../../../lib/equipe.js";

export async function onRequest(ctx) {
  const denied = checkAdmin(ctx.request, ctx.env);
  if (denied) return denied;
  if (!ctx.env.DB) return fail(ctx.request, "base-absente", 503);
  await ensureEquipeTables(ctx.env.DB);
  return route(ctx, ROUTES);
}

const ROUTES = [
  ["GET", ["equipes"], liste],
  ["POST", ["equipes"], creer],
  ["GET", ["equipes", ":id"], equipe(detail)],
  ["POST", ["equipes", ":id"], equipe(modifier)],
  ["DELETE", ["equipes", ":id"], equipe(supprimer)],
  ["POST", ["equipes", ":id", "invitations"], equipe(inviter)],
  ["DELETE", ["equipes", ":id", "invitations", ":inv"], equipe(annulerInvitation)],
  ["DELETE", ["equipes", ":id", "membres", ":compte"], equipe(retirer)],
  ["POST", ["equipes", ":id", "membres", ":compte"], equipe(changerRole)],
];

function equipe(handler) {
  return async (ctx, params) => {
    const team = await ctx.env.DB.prepare("SELECT * FROM equipes WHERE id = ?1").bind(params.id).first();
    if (!team) return fail(ctx.request, "introuvable", 404);
    return handler(ctx, params, team);
  };
}

const int = (v, min, max, d) => {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : d;
};

async function liste({ env }) {
  const teams = (await env.DB.prepare("SELECT * FROM equipes ORDER BY created_at DESC").all()).results;
  const out = [];
  for (const t of teams) {
    const d = await teamDetails(env.DB, t);
    out.push({ ...d, note: t.note || "", owners: d.members.filter((m) => m.role === "proprietaire").map((m) => m.email).concat(d.invitations.filter((i) => i.role === "proprietaire").map((i) => `${i.email} (invité)`)) });
  }
  const accounts = await env.DB.prepare("SELECT COUNT(*) AS n FROM comptes").first();
  return json({ ok: true, teams: out, plans: FORFAITS, stats: { teams: teams.length, accounts: accounts?.n ?? 0, active: out.filter((t) => t.active).length } });
}

async function creer({ request, env }) {
  const b = await body(request);
  const name = clip(b?.name, 60);
  if (name.length < 2) return fail(request, "nom-invalide");
  const plan = FORFAITS[b?.plan] ? b.plan : "studio";
  const base = FORFAITS[plan];
  const status = STATUTS.has(b?.status) ? b.status : "essai";
  const ownerEmail = clip(b?.ownerEmail, 254).toLowerCase();
  if (!EMAIL.test(ownerEmail)) return fail(request, "email-invalide");
  const team = {
    id: crypto.randomUUID(), name, plan,
    seats: int(b?.seats, 1, 500, base.places), storage_gb: int(b?.storageGb, 1, 5000, base.stockageGo),
    status, trial_until: status === "essai" ? iso(Date.now() + int(b?.trialDays, 1, 365, 30) * DAY) : null,
    note: clip(b?.note, 1000), created_at: iso(),
  };
  await env.DB.prepare("INSERT INTO equipes (id, name, plan, seats, storage_gb, status, trial_until, note, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
    .bind(team.id, team.name, team.plan, team.seats, team.storage_gb, team.status, team.trial_until, team.note, team.created_at).run();
  const res = await invite(env, team, { email: ownerEmail, role: "proprietaire", invitedBy: null, inviterName: "Onde", lang: b?.lang === "en" ? "en" : "fr" });
  return json({ ok: true, team: teamView(team), emailSent: res.emailSent });
}

async function detail({ env }, _p, team) {
  return json({ ok: true, team: { ...(await teamDetails(env.DB, team)), note: team.note || "" } });
}

async function modifier({ request, env }, _p, team) {
  const b = await body(request);
  if (!b) return fail(request, "requete-invalide");
  const next = { ...team };
  if (b.name !== undefined) {
    next.name = clip(b.name, 60);
    if (next.name.length < 2) return fail(request, "nom-invalide");
  }
  if (b.plan !== undefined && FORFAITS[b.plan]) next.plan = b.plan;
  if (b.seats !== undefined) next.seats = int(b.seats, 1, 500, team.seats);
  if (b.storageGb !== undefined) next.storage_gb = int(b.storageGb, 1, 5000, team.storage_gb);
  if (b.status !== undefined && STATUTS.has(b.status)) next.status = b.status;
  if (b.trialUntil !== undefined) next.trial_until = b.trialUntil && !Number.isNaN(Date.parse(b.trialUntil)) ? iso(Date.parse(b.trialUntil)) : null;
  if (b.note !== undefined) next.note = clip(b.note, 1000);
  await env.DB.prepare("UPDATE equipes SET name = ?1, plan = ?2, seats = ?3, storage_gb = ?4, status = ?5, trial_until = ?6, note = ?7 WHERE id = ?8")
    .bind(next.name, next.plan, next.seats, next.storage_gb, next.status, next.trial_until, next.note, team.id).run();
  return detail({ env }, null, next);
}

async function supprimer({ env }, _p, team) {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM membres WHERE team_id = ?1").bind(team.id),
    env.DB.prepare("DELETE FROM invitations WHERE team_id = ?1").bind(team.id),
    env.DB.prepare("DELETE FROM equipes WHERE id = ?1").bind(team.id),
  ]);
  return json({ ok: true });
}

async function inviter({ request, env }, _p, team) {
  const b = await body(request);
  const email = clip(b?.email, 254).toLowerCase();
  if (!EMAIL.test(email)) return fail(request, "email-invalide");
  const role = ROLES.has(b?.role) ? b.role : "membre";
  const res = await invite(env, team, { email, role, invitedBy: null, inviterName: "Onde", lang: b?.lang === "en" ? "en" : "fr" });
  return json({ ok: true, invitation: { id: res.id, email, role }, emailSent: res.emailSent });
}

async function annulerInvitation({ env }, { inv }, team) {
  await env.DB.prepare("DELETE FROM invitations WHERE id = ?1 AND team_id = ?2").bind(inv, team.id).run();
  return json({ ok: true });
}

async function retirer({ env }, { compte }, team) {
  await env.DB.prepare("DELETE FROM membres WHERE team_id = ?1 AND account_id = ?2").bind(team.id, compte).run();
  return json({ ok: true });
}

async function changerRole({ request, env }, { compte }, team) {
  const role = (await body(request))?.role;
  if (!ROLES.has(role)) return fail(request, "requete-invalide");
  await env.DB.prepare("UPDATE membres SET role = ?1 WHERE team_id = ?2 AND account_id = ?3").bind(role, team.id, compte).run();
  return json({ ok: true });
}
