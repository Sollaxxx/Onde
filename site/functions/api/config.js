// /api/config : réglages lus par l'application au démarrage (interrupteur des contributions).
import { json, contributionsOpen } from "../../lib/onde.js";

export async function onRequestGet({ env }) {
  return json({ contributions: await contributionsOpen(env) }, 200, { "Cache-Control": "public, max-age=60" });
}
