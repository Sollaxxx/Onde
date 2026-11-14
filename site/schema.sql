-- Base Cloudflare D1 du site Onde (à exécuter une fois dans la console D1).
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,  -- adresse en minuscules, une seule fois
  created_at TEXT NOT NULL,     -- date d'inscription (ISO 8601)
  lang       TEXT               -- langue de la page d'inscription
);
