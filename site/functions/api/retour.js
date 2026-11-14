// Retours des testeurs envoyés depuis l'application : POST /api/retour
// { kind, message, email?, version, os }
// Stockés dans la base Cloudflare D1 « DB », table « retours » (créée automatiquement).

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const KINDS = new Set(["bug", "idee", "autre"]);
const clip = (v, n) => String(v ?? "").trim().slice(0, n);

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Requête invalide." }, 400);
  }

  const message = clip(data?.message, 4000);
  if (message.length < 3) return json({ ok: false, error: "Écrivez quelques mots avant d'envoyer." }, 400);
  const kind = KINDS.has(data?.kind) ? data.kind : "autre";
  const email = clip(data?.email, 254).toLowerCase();
  if (email && !EMAIL.test(email)) return json({ ok: false, error: "Vérifiez l'adresse e-mail : elle semble incomplète." }, 400);

  if (!env.DB) return json({ ok: false, error: "Les retours ne sont pas encore ouverts." }, 503);

  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS retours (id INTEGER PRIMARY KEY AUTOINCREMENT, created_at TEXT NOT NULL, kind TEXT, message TEXT NOT NULL, email TEXT, version TEXT, os TEXT)",
    ).run();
    await env.DB.prepare("INSERT INTO retours (created_at, kind, message, email, version, os) VALUES (?1, ?2, ?3, ?4, ?5, ?6)")
      .bind(new Date().toISOString(), kind, message, email || null, clip(data?.version, 20), clip(data?.os, 40))
      .run();
  } catch {
    return json({ ok: false, error: "Le message n'a pas pu être enregistré. Réessayez dans un instant." }, 500);
  }
  return json({ ok: true });
}

export async function onRequest() {
  return json({ ok: false, error: "Méthode non autorisée." }, 405);
}
