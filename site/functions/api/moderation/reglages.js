// Interrupteur des contributions : POST { contributions: true | false }
import { json } from "../../../lib/onde.js";

export async function onRequestPost({ request, env }) {
  const body = await request.json().catch(() => ({}));
  const on = body.contributions === true ? "1" : "0";
  await env.DB.prepare("INSERT INTO reglages (key, value) VALUES ('contributions', ?1) ON CONFLICT(key) DO UPDATE SET value = ?1").bind(on).run();
  return json({ ok: true, open: on === "1" });
}
