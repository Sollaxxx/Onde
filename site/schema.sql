-- Base Cloudflare D1 du site Onde (à exécuter une fois dans la console D1).
CREATE TABLE IF NOT EXISTS waitlist (
  email      TEXT PRIMARY KEY,  -- adresse en minuscules, une seule fois
  created_at TEXT NOT NULL,     -- date d'inscription (ISO 8601)
  lang       TEXT               -- langue de la page d'inscription
);

-- Retours envoyés depuis l'application (la fonction crée aussi la table si besoin).
CREATE TABLE IF NOT EXISTS retours (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,     -- date d'envoi (ISO 8601)
  kind       TEXT,              -- bug, idee ou autre
  message    TEXT NOT NULL,
  email      TEXT,              -- facultatif, pour pouvoir répondre
  version    TEXT,              -- version d'Onde
  os         TEXT               -- système (ex. windows x86_64)
);
