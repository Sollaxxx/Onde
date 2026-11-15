// /api/contributions : reçoit un son proposé depuis l'application.
// Corps : le fichier audio brut. En-têtes : X-Onde-Meta (JSON encodé), X-Onde-Fichier, X-Onde-Version.
// Le son va dans R2 (contributions/en-attente/) et attend la modération ; rien n'est publié ici.
import { json, contributionsOpen, ensureTables, sha, audioKind } from "../../lib/onde.js";

const MAX_BYTES = 60 * 1024 * 1024;
const PER_DAY = 30;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export async function onRequestPost({ request, env }) {
  if (!(await contributionsOpen(env))) return json({ ok: false, error: "Les contributions ne sont pas encore ouvertes." }, 403);

  const len = Number(request.headers.get("Content-Length") || 0);
  if (len > MAX_BYTES) return json({ ok: false, error: "Fichier trop lourd (60 Mo au maximum)." }, 413);

  let meta;
  try { meta = JSON.parse(decodeURIComponent(request.headers.get("X-Onde-Meta") || "")); } catch { return json({ ok: false, error: "Informations du son illisibles." }, 400); }
  const m = {
    title: clip(meta.title, 80), code: clip(meta.code, 6).toUpperCase(), category: clip(meta.category, 60),
    tags: (Array.isArray(meta.tags) ? meta.tags : []).map((t) => clip(t, 30)).filter(Boolean).slice(0, 12),
    description: clip(meta.description, 300), pseudo: clip(meta.pseudo, 40), email: clip(meta.email, 254).toLowerCase(),
    durationMs: Math.round(Number(meta.durationMs) || 0),
  };
  if (m.title.length < 3) return json({ ok: false, error: "Titre trop court." }, 400);
  if (!/^[A-Z]{2,6}$/.test(m.code)) return json({ ok: false, error: "Catégorie invalide." }, 400);
  if (m.pseudo.length < 2) return json({ ok: false, error: "Pseudo trop court." }, 400);
  if (!EMAIL.test(m.email)) return json({ ok: false, error: "Adresse e-mail invalide." }, 400);
  if (meta.license !== "CC0") return json({ ok: false, error: "La licence CC0 doit être acceptée." }, 400);
  if (m.durationMs > 180000) return json({ ok: false, error: "Son trop long (3 minutes au maximum)." }, 400);

  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_BYTES) return json({ ok: false, error: "Fichier trop lourd (60 Mo au maximum)." }, 413);
  if (bytes.byteLength < 1000) return json({ ok: false, error: "Fichier vide ou trop court." }, 400);
  const kind = audioKind(bytes);
  if (!kind) return json({ ok: false, error: "Format non reconnu : WAV, FLAC, MP3, AIFF, OGG ou M4A." }, 415);

  await ensureTables(env.DB);
  const ipHash = (await sha("onde:" + (request.headers.get("CF-Connecting-IP") || ""))).slice(0, 24);
  const since = new Date(Date.now() - 86400000).toISOString();
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM contributions WHERE created_at > ?1 AND (ip_hash = ?2 OR email = ?3)")
    .bind(since, ipHash, m.email).first();
  if ((recent?.n ?? 0) >= PER_DAY) return json({ ok: false, error: "Beaucoup de sons envoyés aujourd'hui : réessayez demain." }, 429);

  const id = (await sha(crypto.randomUUID())).slice(0, 12);
  const key = `contributions/en-attente/${id}.${kind.ext}`;
  await env.SONS.put(key, bytes, { httpMetadata: { contentType: kind.type }, customMetadata: { id } });
  await env.DB.prepare(`INSERT INTO contributions (id, created_at, status, email, pseudo, title, code, category, tags, description, duration_ms, file_name, ext, size, r2_key, ip_hash, version)
    VALUES (?1, ?2, 'attente', ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16)`)
    .bind(id, new Date().toISOString(), m.email, m.pseudo, m.title, m.code, m.category, JSON.stringify(m.tags), m.description,
      m.durationMs, clip(decodeURIComponent(request.headers.get("X-Onde-Fichier") || ""), 200), kind.ext, bytes.byteLength, key, ipHash,
      clip(request.headers.get("X-Onde-Version"), 20))
    .run();
  return json({ ok: true, id });
}

export async function onRequest() {
  return json({ ok: false, error: "Méthode non autorisée." }, 405);
}
