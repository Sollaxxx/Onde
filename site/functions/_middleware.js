// Redirige l'ancienne adresse (onde-nis.pages.dev) et www.ondesound.com vers https://ondesound.com.
// Exceptions : les appels des applications déjà installées (/api/…) continuent de fonctionner
// sur l'ancienne adresse, sans redirection (une redirection ferait échouer les envois).
// Les aperçus de chaque PR (xxxx.onde-nis.pages.dev) ne sont pas redirigés.
const DOMAINE = "ondesound.com";
const ANCIENS = new Set(["onde-nis.pages.dev", "www.ondesound.com"]);

export async function onRequest({ request, next }) {
  const url = new URL(request.url);
  if (ANCIENS.has(url.hostname) && !url.pathname.startsWith("/api/")) {
    url.hostname = DOMAINE;
    url.protocol = "https:";
    url.port = "";
    return Response.redirect(url.toString(), 301);
  }
  return next();
}
