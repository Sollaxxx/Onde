#!/usr/bin/env python3
"""Envoie la bibliothèque produite par les scripts d'import vers Cloudflare R2.

Organisation dans le bucket :
  sons/<fichier>              les sons (WAV ou MP3)
  catalogue/v1.json           le catalogue lu par l'application

La clé d'accès n'est jamais lue par ce script : dans l'environnement cloud d'Onde,
elle est ajoutée automatiquement aux requêtes vers api.cloudflare.com. Ailleurs,
définissez la variable CLOUDFLARE_API_TOKEN.

Reprise : les fichiers déjà envoyés sont notés dans <bibliotheque>/envoyes.json.

Usage :
  python3 scripts/import/envoyer_r2.py --bibliotheque DOSSIER --compte ID_COMPTE [--bucket onde-sons] [--limite N]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import json
import os
import sys
import threading
import time
import urllib.parse
import urllib.request
from pathlib import Path

TYPES = {".wav": "audio/wav", ".mp3": "audio/mpeg", ".json": "application/json; charset=utf-8"}
lock = threading.Lock()


def put(url: str, data: bytes, content_type: str, token: str) -> None:
    req = urllib.request.Request(url, data=data, method="PUT", headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": content_type,
        "Cache-Control": "public, max-age=31536000, immutable" if not content_type.startswith("application/json") else "public, max-age=300",
    })
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=600) as r:
                body = json.loads(r.read() or b"{}")
            if body.get("success", True):
                return
            raise RuntimeError(body.get("errors"))
        except Exception as e:
            if attempt == 3:
                raise
            time.sleep(5 * (attempt + 1))


def app_entry(s: dict) -> dict:
    """Ce dont l'application a besoin (on retire les champs internes)."""
    keep = ["id", "title", "titleEn", "description", "descriptionEn", "code", "ucs", "category", "tags",
            "durationMs", "file", "format", "license", "author", "credit", "source", "sourceUrl", "peaks", "bytes"]
    return {k: s[k] for k in keep if k in s}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bibliotheque", type=Path, required=True)
    ap.add_argument("--compte", required=True)
    ap.add_argument("--bucket", default="onde-sons")
    ap.add_argument("--limite", type=int, default=0, help="n'envoyer que N sons (test)")
    ap.add_argument("--sans-catalogue", action="store_true")
    ap.add_argument("--cdn", default="https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev",
                    help="adresse publique de la bibliothèque (pour garder les sons de la communauté déjà publiés)")
    args = ap.parse_args()

    token = os.environ.get("CLOUDFLARE_API_TOKEN", "proxy-injected")
    base = f"https://api.cloudflare.com/client/v4/accounts/{args.compte}/r2/buckets/{args.bucket}/objects/"
    catalog = json.loads((args.bibliotheque / "catalog.json").read_text(encoding="utf-8"))
    state_path = args.bibliotheque / "envoyes.json"
    sent: set[str] = set(json.loads(state_path.read_text())) if state_path.exists() else set()
    todo = [s for s in catalog if s["file"] not in sent]
    if args.limite:
        todo = todo[: args.limite]
    total = sum(s["bytes"] for s in todo)
    print(f"{len(todo)} sons à envoyer ({total/1024**3:.2f} Go), {len(sent)} déjà envoyés", flush=True)

    done_bytes = 0
    t0 = time.time()

    def send(s: dict) -> dict:
        path = args.bibliotheque / "sons" / s["file"]
        put(base + "sons/" + urllib.parse.quote(s["file"]), path.read_bytes(), TYPES.get(path.suffix.lower(), "application/octet-stream"), token)
        return s

    with cf.ThreadPoolExecutor(max_workers=4) as pool:
        for i, s in enumerate(pool.map(send, todo), 1):
            with lock:
                sent.add(s["file"]); done_bytes += s["bytes"]
            if i % 100 == 0 or i == len(todo):
                state_path.write_text(json.dumps(sorted(sent)))
                speed = done_bytes / max(1, time.time() - t0) / 1024**2
                print(f"  {i}/{len(todo)} envoyés · {done_bytes/1024**3:.2f} Go · {speed:.1f} Mo/s", flush=True)
    state_path.write_text(json.dumps(sorted(sent)))

    if not args.sans_catalogue:
        published = [app_entry(s) for s in catalog if s["file"] in sent]
        # Les sons publiés par la communauté (page de modération) ne sont pas dans ce dossier :
        # on les reprend du catalogue en ligne pour ne jamais les effacer.
        try:
            with urllib.request.urlopen(f"{args.cdn}/catalogue/v1.json", timeout=60) as r:
                online = json.loads(r.read().decode("utf-8"))
            ids = {s["id"] for s in published}
            community = [s for s in online.get("sounds", []) if s.get("contribution") and s["id"] not in ids]
            published += community
            print(f"{len(community)} sons de la communauté conservés", flush=True)
        except Exception as e:  # noqa: BLE001
            print(f"Catalogue en ligne illisible ({e}) : publication annulée pour ne pas perdre les contributions.", flush=True)
            return 1
        doc = {"version": 1, "generatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "count": len(published), "sounds": published}
        put(base + "catalogue/v1.json", json.dumps(doc, ensure_ascii=False).encode("utf-8"), TYPES[".json"], token)
        print(f"Catalogue publié : {len(published)} sons", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
