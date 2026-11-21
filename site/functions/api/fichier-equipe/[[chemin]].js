// Fichier d'un son d'équipe, par lien temporaire signé : /api/fichier-equipe/:equipe/:son/:expiration/:signature/:nom
// Le lien est donné aux membres par /api/equipe/:id/contenu (valable 12 h). Il marche sans en-tête d'authentification,
// ce qui permet la pré-écoute en continu (lecteur audio) et le téléchargement depuis les panneaux Premiere et DaVinci.
// Les demandes partielles (Range) sont acceptées : on peut se déplacer dans un long son sans tout télécharger.
import { checkSignature, ensureEquipeTables, fail, teamActive } from "../../../lib/equipe.js";

export async function onRequestGet(ctx) {
  return serve(ctx, false);
}

export async function onRequestHead(ctx) {
  return serve(ctx, true);
}

async function serve({ request, env, params }, head) {
  const [teamId, soundId, exp, sig] = [].concat(params?.chemin ?? []);
  if (!env.DB || !env.EQUIPES) return fail(request, "stockage-absent", 503);
  if (!teamId || !soundId || !(await checkSignature(env, teamId, soundId, exp, sig))) return fail(request, "lien-expire", 403);
  await ensureEquipeTables(env.DB);
  const sound = await env.DB.prepare("SELECT s.r2_key, s.size, s.file_name FROM sons_equipe s WHERE s.id = ?1 AND s.team_id = ?2").bind(soundId, teamId).first();
  if (!sound) return fail(request, "introuvable", 404);
  const team = await env.DB.prepare("SELECT * FROM equipes WHERE id = ?1").bind(teamId).first();
  if (!team || !teamActive(team)) return fail(request, "equipe-inactive", 403);

  const size = sound.size;
  let offset = 0;
  let length = size;
  const m = /^bytes=(\d*)-(\d*)$/.exec(request.headers.get("Range") || "");
  if (m && (m[1] || m[2])) {
    if (m[1]) {
      offset = Number(m[1]);
      length = (m[2] ? Math.min(Number(m[2]), size - 1) : size - 1) - offset + 1;
    } else {
      length = Math.min(Number(m[2]), size);
      offset = size - length;
    }
    if (offset >= size || length <= 0) {
      return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${size}` } });
    }
  }
  const partial = !!m && (offset !== 0 || length !== size);
  const obj = head ? await env.EQUIPES.head(sound.r2_key) : await env.EQUIPES.get(sound.r2_key, partial ? { range: { offset, length } } : undefined);
  if (!obj) return fail(request, "introuvable", 404);
  const headers = {
    "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
    "Content-Length": String(length),
    "Accept-Ranges": "bytes",
    "Cache-Control": "private, max-age=3600",
    "Content-Disposition": `inline; filename*=UTF-8''${encodeURIComponent(sound.file_name)}`,
  };
  if (partial) headers["Content-Range"] = `bytes ${offset}-${offset + length - 1}/${size}`;
  return new Response(head ? null : obj.body, { status: partial ? 206 : 200, headers });
}
