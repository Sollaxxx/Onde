// Catégories existantes de la bibliothèque (pour corriger celle d'un son proposé).
import { json, readCatalogue } from "../../../lib/onde.js";

export async function onRequestGet({ env }) {
  const cat = await readCatalogue(env);
  const map = new Map();
  for (const s of cat.sounds) if (!map.has(s.code)) map.set(s.code, s.category);
  return json({ ok: true, categories: [...map].map(([code, name]) => ({ code, name })).sort((a, b) => a.name.localeCompare(b.name, "fr")) });
}
