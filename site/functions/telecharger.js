// /telecharger : redirige vers l'installateur Windows (Mac : /telecharger/mac) de la dernière version publiée.
// On lit le fichier latest.json que chaque version publie sur GitHub (celui des mises à jour
// automatiques) : le lien suit donc les nouvelles versions sans rien modifier sur le site.
// Réponse gardée 10 minutes en cache ; en cas de problème, on renvoie vers la page des versions.

const LATEST = "https://github.com/Sollaxxx/Onde/releases/latest/download/latest.json";
const RELEASES = "https://github.com/Sollaxxx/Onde/releases/latest";

export async function latestJson() {
  const res = await fetch(LATEST, { cf: { cacheTtl: 600, cacheEverything: true } });
  if (!res.ok) throw new Error(`latest.json : ${res.status}`);
  return res.json();
}

export async function latestRelease() {
  const data = await latestJson();
  const win = data.platforms?.["windows-x86_64"] ?? data.platforms?.["windows-x86_64-nsis"];
  if (!win?.url) throw new Error("pas d'installateur Windows");
  return { version: data.version, url: win.url, date: data.pub_date };
}

export async function onRequestGet() {
  try {
    const { url } = await latestRelease();
    return Response.redirect(url, 302);
  } catch {
    return Response.redirect(RELEASES, 302);
  }
}
