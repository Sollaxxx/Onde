// Publie un son validé. Corps : le WAV final (48 kHz, 16 bits, stéréo) préparé par la page de modération.
// En-tête X-Onde-Meta : { id, title, titleEn, code, category, tags, description, durationMs, peaks }.
// Le son rejoint sons/ et le catalogue lu par l'application ; l'original en attente est supprimé.
import { json, slug, readCatalogue, CATALOGUE_KEY } from "../../../lib/onde.js";

export async function onRequestPost({ request, env }) {
  let m;
  try { m = JSON.parse(decodeURIComponent(request.headers.get("X-Onde-Meta") || "")); } catch { return json({ ok: false, error: "Informations illisibles." }, 400); }
  const row = await env.DB.prepare("SELECT * FROM contributions WHERE id = ?1 AND status = 'attente'").bind(String(m.id || "")).first();
  if (!row) return json({ ok: false, error: "Contribution introuvable ou déjà traitée." }, 404);
  const wav = await request.arrayBuffer();
  const head = String.fromCharCode(...new Uint8Array(wav.slice(0, 12)));
  if (!head.startsWith("RIFF") || head.slice(8) !== "WAVE") return json({ ok: false, error: "Le fichier final doit être un WAV." }, 400);

  const code = String(m.code || row.code).toUpperCase().slice(0, 6);
  const title = String(m.title || row.title).trim().slice(0, 80);
  const file = `${code}_${slug(title)}_C${row.id}.wav`;
  await env.SONS.put(`sons/${file}`, wav, { httpMetadata: { contentType: "audio/wav", cacheControl: "public, max-age=31536000, immutable" } });

  const cat = await readCatalogue(env);
  cat.sounds = cat.sounds.filter((s) => s.contribution !== row.id);
  cat.sounds.push({
    id: `com-${row.id}`,
    contribution: row.id,
    title,
    titleEn: String(m.titleEn || title).slice(0, 80),
    description: String(m.description ?? row.description ?? "").slice(0, 300),
    code,
    category: String(m.category || row.category),
    tags: (Array.isArray(m.tags) ? m.tags : JSON.parse(row.tags || "[]")).map((t) => String(t).slice(0, 30)).slice(0, 12),
    durationMs: Math.round(Number(m.durationMs) || row.duration_ms || 0),
    file,
    format: "WAV · 48 kHz · 16 bits · stéréo",
    license: "CC0",
    author: row.pseudo,
    credit: `${row.pseudo} · communauté Onde`,
    source: "Communauté Onde",
    peaks: (Array.isArray(m.peaks) ? m.peaks : []).slice(0, 120).map((v) => Math.round(Number(v) * 1000) / 1000),
  });
  cat.count = cat.sounds.length;
  cat.generatedAt = new Date().toISOString();
  await env.SONS.put(CATALOGUE_KEY, JSON.stringify(cat), { httpMetadata: { contentType: "application/json; charset=utf-8", cacheControl: "public, max-age=300" } });

  await env.SONS.delete(row.r2_key);
  await env.DB.prepare("UPDATE contributions SET status = 'publie', decided_at = ?2, published_file = ?3, title = ?4, code = ?5 WHERE id = ?1")
    .bind(row.id, new Date().toISOString(), file, title, code).run();
  return json({ ok: true, file, count: cat.count });
}
