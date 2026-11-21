// /api/config : réglages lus par l'application au démarrage.
//   contributions : les utilisateurs peuvent proposer leurs sons (réglé depuis la modération)
//   comptes       : la connexion (Onde Équipe) apparaît dans l'application. Variables du projet Pages :
//                   COMPTES_OUVERTS=1 et RESEND_API_KEY (sans envoi d'e-mails, personne ne pourrait se connecter).
import { json, contributionsOpen } from "../../lib/onde.js";

export async function onRequestGet({ env }) {
  return json({ contributions: await contributionsOpen(env), comptes: env.COMPTES_OUVERTS === "1" && !!env.RESEND_API_KEY && !!env.DB }, 200, { "Cache-Control": "public, max-age=60" });
}
