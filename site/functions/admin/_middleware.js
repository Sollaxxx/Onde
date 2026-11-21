// La page /admin (gestion des équipes Onde Équipe) n'est accessible qu'avec le mot de passe d'administration.
import { checkAdmin } from "../../lib/onde.js";

export async function onRequest({ request, env, next }) {
  return checkAdmin(request, env) ?? next();
}
