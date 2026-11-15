// Outils partagés par les fonctions du site (contributions et modération).
// Liaisons Cloudflare attendues : DB (base D1) et SONS (bucket R2 « onde-sons »).

export const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...headers },
  });

export async function ensureTables(db) {
  await db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS reglages (key TEXT PRIMARY KEY, value TEXT)"),
    db.prepare(`CREATE TABLE IF NOT EXISTS contributions (
      id TEXT PRIMARY KEY, created_at TEXT NOT NULL, status TEXT NOT NULL,
      email TEXT, pseudo TEXT, title TEXT, code TEXT, category TEXT, tags TEXT, description TEXT,
      duration_ms INTEGER, file_name TEXT, ext TEXT, size INTEGER, r2_key TEXT,
      ip_hash TEXT, version TEXT, decided_at TEXT, note TEXT, published_file TEXT)`),
  ]);
}

/** Les contributions sont-elles ouvertes ? (fermées par défaut, et si une liaison manque) */
export async function contributionsOpen(env) {
  if (!env.DB || !env.SONS) return false;
  try {
    await ensureTables(env.DB);
    const row = await env.DB.prepare("SELECT value FROM reglages WHERE key = 'contributions'").first();
    return row?.value === "1";
  } catch {
    return false;
  }
}

export function slug(s) {
  return String(s).replace(/œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "son";
}

export async function sha(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Accès à la modération : mot de passe défini dans les variables secrètes du projet Pages. */
export function checkModerator(request, env) {
  const secret = env.MODERATION_MOT_DE_PASSE;
  if (!secret) return new Response("Modération non configurée : ajoutez la variable secrète MODERATION_MOT_DE_PASSE.", { status: 503 });
  const auth = request.headers.get("Authorization") || "";
  let pass = "";
  if (auth.startsWith("Basic ")) {
    try { pass = atob(auth.slice(6)).split(":").slice(1).join(":"); } catch { /* en-tête invalide */ }
  }
  // comparaison en temps constant
  let diff = pass.length ^ secret.length;
  for (let i = 0; i < Math.max(pass.length, secret.length); i++) diff |= (pass.charCodeAt(i) || 0) ^ (secret.charCodeAt(i) || 0);
  if (diff !== 0) {
    return new Response("Accès réservé à la modération d'Onde.", {
      status: 401,
      headers: { "WWW-Authenticate": 'Basic realm="Moderation Onde", charset="UTF-8"', "Cache-Control": "no-store" },
    });
  }
  return null;
}

/** Type audio d'après les premiers octets du fichier (on ne se fie pas à l'extension). */
export function audioKind(bytes) {
  const b = new Uint8Array(bytes.slice(0, 16));
  const s = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (s(0, 4) === "RIFF" && s(8, 4) === "WAVE") return { ext: "wav", type: "audio/wav" };
  if (s(0, 4) === "fLaC") return { ext: "flac", type: "audio/flac" };
  if (s(0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return { ext: "mp3", type: "audio/mpeg" };
  if (s(0, 4) === "FORM" && (s(8, 4) === "AIFF" || s(8, 4) === "AIFC")) return { ext: "aiff", type: "audio/aiff" };
  if (s(0, 4) === "OggS") return { ext: "ogg", type: "audio/ogg" };
  if (s(4, 4) === "ftyp") return { ext: "m4a", type: "audio/mp4" };
  return null;
}

export const CATALOGUE_KEY = "catalogue/v1.json";

export async function readCatalogue(env) {
  const obj = await env.SONS.get(CATALOGUE_KEY);
  if (!obj) throw new Error("catalogue introuvable dans R2");
  return obj.json();
}
