// Sons en attente, décisions récentes et état de l'interrupteur.
import { json, contributionsOpen } from "../../../lib/onde.js";

export async function onRequestGet({ env }) {
  const pending = await env.DB.prepare("SELECT * FROM contributions WHERE status = 'attente' ORDER BY created_at ASC LIMIT 200").all();
  const recent = await env.DB.prepare("SELECT id, title, pseudo, status, decided_at, note, published_file FROM contributions WHERE status != 'attente' ORDER BY decided_at DESC LIMIT 30").all();
  const counts = await env.DB.prepare("SELECT status, COUNT(*) AS n FROM contributions GROUP BY status").all();
  return json({
    ok: true,
    open: await contributionsOpen(env),
    pending: pending.results.map((r) => ({ ...r, tags: JSON.parse(r.tags || "[]") })),
    recent: recent.results,
    counts: Object.fromEntries(counts.results.map((r) => [r.status, r.n])),
  });
}
