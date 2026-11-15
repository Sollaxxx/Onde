// /telecharger/mac : redirige vers l'image disque Mac (.dmg, Intel et Apple Silicon) de la dernière version.
// Le .dmg n'est pas dans latest.json (qui sert aux mises à jour) : on le retrouve à côté
// de l'archive Mac de la même version, sous le nom que lui donne la compilation.
import { latestJson } from "../telecharger.js";

const RELEASES = "https://github.com/Sollaxxx/Onde/releases/latest";

export async function macRelease() {
  const data = await latestJson();
  const mac = data.platforms?.["darwin-universal"] ?? data.platforms?.["darwin-aarch64"] ?? data.platforms?.["darwin-x86_64"];
  if (!mac?.url) throw new Error("pas de version Mac");
  const dir = mac.url.slice(0, mac.url.lastIndexOf("/") + 1);
  return { version: data.version, url: `${dir}Onde_${data.version}_universal.dmg` };
}

export async function onRequestGet() {
  try {
    const { url } = await macRelease();
    return Response.redirect(url, 302);
  } catch {
    return Response.redirect(RELEASES, 302);
  }
}
