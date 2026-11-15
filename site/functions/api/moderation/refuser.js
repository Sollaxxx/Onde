// Refuse un son : il est supprimé de R2, la raison est gardée pour mémoire.
import { json } from "../../../lib/onde.js";

export async function onRequestPost({ request, env }) {
  const { id, note } = await request.json().catch(() => ({}));
  const row = await env.DB.prepare("SELECT r2_key FROM contributions WHERE id = ?1 AND status = 'attente'").bind(String(id || "")).first();
  if (!row) return json({ ok: false, error: "Contribution introuvable ou déjà traitée." }, 404);
  await env.SONS.delete(row.r2_key);
  await env.DB.prepare("UPDATE contributions SET status = 'refuse', decided_at = ?2, note = ?3 WHERE id = ?1")
    .bind(id, new Date().toISOString(), String(note || "").slice(0, 300)).run();
  return json({ ok: true });
}
