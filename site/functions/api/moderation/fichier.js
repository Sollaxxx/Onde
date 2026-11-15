// Fichier d'origine d'un son en attente (pour l'écouter et le convertir dans la page de modération).
import { json } from "../../../lib/onde.js";

export async function onRequestGet({ request, env }) {
  const id = new URL(request.url).searchParams.get("id") || "";
  const row = await env.DB.prepare("SELECT r2_key FROM contributions WHERE id = ?1").bind(id).first();
  if (!row) return json({ ok: false, error: "Contribution inconnue." }, 404);
  const obj = await env.SONS.get(row.r2_key);
  if (!obj) return json({ ok: false, error: "Fichier introuvable." }, 404);
  return new Response(obj.body, { headers: { "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream", "Cache-Control": "private, no-store" } });
}
