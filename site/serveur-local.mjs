// Serveur de test local pour les comptes et les équipes (sans Cloudflare) :
// base D1 simulée en mémoire, mode test (le code de connexion est renvoyé dans la réponse).
// Usage : node site/serveur-local.mjs [port]   → http://localhost:8787/admin/ (mot de passe : admin)
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { extname, join, normalize } from "node:path";
import * as compte from "./functions/api/compte/[[chemin]].js";
import * as equipe from "./functions/api/equipe/[[chemin]].js";
import * as admin from "./functions/api/admin/[[chemin]].js";
import { checkAdmin } from "./lib/onde.js";

const sqlite = new DatabaseSync(":memory:");
const stmt = (sql, args = []) => ({
  bind: (...a) => stmt(sql, a),
  run: async () => { sqlite.prepare(sql).run(...args); return { success: true }; },
  first: async () => sqlite.prepare(sql).get(...args) ?? null,
  all: async () => ({ results: sqlite.prepare(sql).all(...args) }),
});
const env = { DB: { prepare: (sql) => stmt(sql), batch: async (l) => { for (const s of l) await s.run(); } }, ONDE_DEV: "1", ADMIN_MOT_DE_PASSE: "admin" };
const ROOT = new URL("./public/", import.meta.url).pathname;
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css", ".js": "text/javascript", ".woff2": "font/woff2", ".svg": "image/svg+xml", ".png": "image/png" };
const port = Number(process.argv[2] || 8787);

createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "Authorization, Content-Type, X-Onde-Langue", "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS" };
  if (req.method === "OPTIONS") { res.writeHead(204, cors); res.end(); return; }
  const chunks = []; for await (const c of req) chunks.push(c);
  const body = chunks.length ? Buffer.concat(chunks) : undefined;
  const request = new Request(url, { method: req.method, headers: { ...req.headers, "CF-Connecting-IP": "127.0.0.1" }, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
  const m = /^\/api\/(compte|equipe|admin)(?:\/(.*))?$/.exec(url.pathname);
  let response;
  if (m) {
    const mod = { compte, equipe, admin }[m[1]];
    response = await mod.onRequest({ request, env, params: { chemin: (m[2] || "").split("/").filter(Boolean) } });
  } else {
    if (url.pathname.startsWith("/admin")) response = checkAdmin(request, env);
    if (!response) {
      let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
      if (p.endsWith("/")) p += "index.html";
      try { response = new Response(await readFile(join(ROOT, p)), { headers: { "Content-Type": TYPES[extname(p)] || "application/octet-stream" } }); }
      catch { response = new Response("introuvable", { status: 404 }); }
    }
  }
  res.writeHead(response.status, { ...Object.fromEntries(response.headers), ...cors });
  res.end(Buffer.from(await response.arrayBuffer()));
}).listen(port, () => console.log(`Serveur local : http://localhost:${port}/admin/ (mot de passe « admin »)`));
