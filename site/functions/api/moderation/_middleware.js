// Toutes les routes /api/moderation/* exigent le mot de passe de modération et les liaisons D1 + R2.
import { checkModerator, json, ensureTables } from "../../../lib/onde.js";

export async function onRequest({ request, env, next }) {
  const denied = checkModerator(request, env);
  if (denied) return denied;
  if (!env.DB || !env.SONS) return json({ ok: false, error: "Liaisons manquantes : DB (D1) et SONS (R2)." }, 503);
  await ensureTables(env.DB);
  return next();
}
