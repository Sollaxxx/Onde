// Liste d'attente de la bêta : POST /api/inscription  { email, lang, site }
// Les adresses sont stockées dans la base Cloudflare D1 liée au site sous le nom « DB ».
// Le champ « site » est un piège à robots : un humain le laisse toujours vide.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
  });

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const TEXT = {
  fr: {
    bad: "Requête invalide.",
    email: "Vérifiez l'adresse e-mail : elle semble incomplète.",
    soon: "La liste d'attente ouvre très bientôt. Revenez dans quelques jours.",
    fail: "L'inscription n'a pas fonctionné. Réessayez dans un instant.",
  },
  en: {
    bad: "Invalid request.",
    email: "Please check the email address: it looks incomplete.",
    soon: "The waitlist opens very soon. Please come back in a few days.",
    fail: "Sign-up didn't go through. Please try again in a moment.",
  },
};

export async function onRequestPost({ request, env }) {
  let data;
  try {
    data = await request.json();
  } catch {
    return json({ ok: false, error: TEXT.fr.bad }, 400);
  }

  const lang = String((data && data.lang) || "fr").slice(0, 2) === "en" ? "en" : "fr";
  const t = TEXT[lang];

  if (data && data.site) return json({ ok: true }); // robot : on fait comme si de rien n'était

  const email = String((data && data.email) || "").trim().toLowerCase();
  if (email.length > 254 || !EMAIL.test(email)) {
    return json({ ok: false, error: t.email }, 400);
  }

  if (!env.DB) {
    return json({ ok: false, error: t.soon }, 503);
  }

  try {
    await env.DB.prepare("INSERT OR IGNORE INTO waitlist (email, created_at, lang) VALUES (?1, ?2, ?3)")
      .bind(email, new Date().toISOString(), lang)
      .run();
  } catch {
    return json({ ok: false, error: t.fail }, 500);
  }
  return json({ ok: true });
}

export async function onRequest() {
  return json({ ok: false, error: "Méthode non autorisée." }, 405);
}
