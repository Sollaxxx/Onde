// /api/version : numéro et date de la dernière version publiée (affichés près du bouton Télécharger).
import { latestRelease } from "../telecharger.js";

export async function onRequestGet() {
  try {
    const { version, date } = await latestRelease();
    return new Response(JSON.stringify({ version, date }), {
      headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "public, max-age=600" },
    });
  } catch {
    return new Response(JSON.stringify({ version: null }), { status: 503, headers: { "Content-Type": "application/json; charset=utf-8" } });
  }
}
