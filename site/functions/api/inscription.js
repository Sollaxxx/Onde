// Liste d'attente de la bêta : POST /api/inscription  { email, lang, site }
// Les adresses sont stockées dans la base Cloudflare D1 liée au site sous le nom « DB ».
// Le champ « site » est un piège à robots : un humain le laisse toujours vide.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: "Requête invalide." }, 400);
  }

  if (data && data.site) return json({ ok: true }); // robot : on fait comme si de rien n'était

  const email = String((data && data.email) || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return json({ ok: false, error: "Vérifiez l'adresse e-mail : elle semble incomplète." }, 400);
  }

  if (!env.DB) {
    return json({ ok: false, error: "La liste d'attente ouvre très bientôt. Revenez dans quelques jours." }, 503);
  }

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, created_at, lang) VALUES (?1, ?2, ?3)")
      .bind(email, new Date().toISOString(), String(data.lang || "fr").slice(0, 5))
      .run();
  } catch {
    return json({ ok: false, error: "L'inscription n'a pas fonctionné. Réessayez dans un instant." }, 500);
  }
  return json({ ok: true });
}

export async function onRequest() {
  return json({ ok: false, error: "Méthode non autorisée." }, 405);
}
