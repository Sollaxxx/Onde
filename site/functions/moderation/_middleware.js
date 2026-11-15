// La page /moderation n'est accessible qu'avec le mot de passe de modération.
import { checkModerator } from "../../lib/onde.js";

export async function onRequest({ request, env, next }) {
  return checkModerator(request, env) ?? next();
}
