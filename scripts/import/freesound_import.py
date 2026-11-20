#!/usr/bin/env python3
"""Import de sons CC0 depuis Freesound (API v2), pour le montage vidéo : risers, whooshes, bass drops…

Accord de Freesound (support, 20/11/2026) : API utilisable gratuitement tant qu'Onde est gratuit et
non commercial. Si une offre payante arrive (Onde+), redemander l'accord à Freesound.

Seuls les sons sous licence CC0 sont pris. Pour chaque recherche : les sons les plus téléchargés,
bien notés, de 0,2 à 20 s, en 44,1 kHz ou plus. Fichiers originaux (WAV, FLAC…) convertis comme
les autres imports (importer.py : silence de début retiré, volume normalisé, WAV 48 kHz, mono gardé).

Accès : le jeton OAuth (24 h) est ajouté aux requêtes par le proxy de l'environnement Onde ;
ailleurs, définir FREESOUND_TOKEN (jeton OAuth2, « Bearer »).

Usage :
  python3 scripts/import/freesound_import.py --sortie DOSSIER --reference v1.json [--max-go 1.0]
"""
from __future__ import annotations

import argparse
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from importer import Doublons, convert, pcm_hash, peaks_of, probe, slug  # noqa: E402
from finaliser import FR  # noqa: E402

API = "https://freesound.org/apiv2"
UA = "OndeImporter/0.1 (+https://ondesound.com; contact.ondesound@gmail.com)"
PAUSE = 1.1  # Freesound : 60 requêtes par minute au maximum

# (recherche, nombre de sons voulus, code, UCS, catégorie)
QUERIES = [
    ("riser", 60, "DSGN", "DSGNRise", "Design sonore"),
    ("cinematic riser", 30, "DSGN", "DSGNRise", "Design sonore"),
    ("downlifter", 20, "DSGN", "DSGNRise", "Design sonore"),
    ("whoosh", 70, "SWSH", "SWSHWhsh", "Whooshes"),
    ("swoosh", 40, "SWSH", "SWSHSwsh", "Whooshes"),
    ("transition", 40, "SWSH", "SWSHWhsh", "Whooshes"),
    ("reverse cymbal", 15, "DSGN", "DSGNRvrs", "Design sonore"),
    ("reverse swell", 15, "DSGN", "DSGNRvrs", "Design sonore"),
    ("bass drop", 40, "DSGN", "DSGNBass", "Design sonore"),
    ("sub drop", 30, "DSGN", "DSGNBass", "Design sonore"),
    ("808", 20, "DSGN", "DSGNBass", "Design sonore"),
    ("cinematic impact", 50, "DSGN", "DSGNImpt", "Design sonore"),
    ("trailer hit", 30, "DSGN", "DSGNImpt", "Design sonore"),
    ("braam", 15, "DSGN", "DSGNBram", "Design sonore"),
    ("boom", 30, "DSGN", "DSGNBoom", "Design sonore"),
    ("stinger", 20, "DSGN", "DSGNStngr", "Design sonore"),
    ("glitch", 40, "DSGN", "DSGNMisc", "Design sonore"),
    ("tape stop", 15, "DSGN", "DSGNMisc", "Design sonore"),
    ("record scratch", 15, "MUSC", "MUSCMisc", "Musique et instruments"),
    ("drum roll", 10, "MUSC", "MUSCPerc", "Musique et instruments"),
    ("pop", 30, "TOON", "TOONPop", "Cartoon"),
    ("swish", 25, "SWSH", "SWSHSwsh", "Whooshes"),
    ("camera shutter", 15, "OBJ", "OBJCam", "Objets"),
    ("cash register", 10, "OBJ", "OBJCoin", "Objets"),
    ("notification", 25, "UI", "UIAlert", "Interface"),
    ("sparkle", 20, "MAGC", "MAGCShim", "Magie"),
]

FIELDS = "id,name,tags,description,username,license,duration,samplerate,channels,type,filesize,num_downloads,avg_rating,num_ratings,url"


def api(path: str, params: dict | None = None) -> dict:
    url = f"{API}{path}" + ("?" + urllib.parse.urlencode(params) if params else "")
    headers = {"User-Agent": UA}
    if os.environ.get("FREESOUND_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['FREESOUND_TOKEN']}"
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=headers), timeout=60) as r:
                time.sleep(PAUSE)
                return json.loads(r.read().decode("utf-8"))
        except urllib.error.HTTPError as e:
            if e.code == 429:
                time.sleep(30 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"Freesound ne répond pas : {path}")


def download(sound_id: int, dest: Path) -> bool:
    headers = {"User-Agent": UA}
    if os.environ.get("FREESOUND_TOKEN"):
        headers["Authorization"] = f"Bearer {os.environ['FREESOUND_TOKEN']}"
    try:
        with urllib.request.urlopen(urllib.request.Request(f"{API}/sounds/{sound_id}/download/", headers=headers), timeout=180) as r:
            dest.write_bytes(r.read())
        time.sleep(PAUSE)
        return dest.stat().st_size > 512
    except Exception as e:  # noqa: BLE001
        print(f"    ! téléchargement impossible ({sound_id}) : {e}", flush=True)
        return False


def clean_title(name: str) -> str:
    t = re.sub(r"\.(wav|aiff?|flac|mp3|ogg|m4a)$", "", name, flags=re.I)
    t = re.sub(r"[_]+", " ", t)
    t = re.sub(r"\s*-\s*", " - ", t)
    t = re.sub(r"\s+", " ", t).strip(" -")
    return (t[:1].upper() + t[1:])[:80] or "Untitled"


def clean_desc(d: str) -> str:
    d = html.unescape(re.sub(r"<[^>]+>", " ", d or ""))
    d = re.sub(r"https?://\S+", "", d)
    d = re.sub(r"\s+", " ", d).strip()
    return d[:280] + ("…" if len(d) > 280 else "")


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", type=Path, required=True)
    ap.add_argument("--reference", type=Path, action="append", default=[])
    ap.add_argument("--max-go", type=float, default=1.0, help="taille maximale de cet import (Gio)")
    args = ap.parse_args()
    files, raw = args.sortie / "sons", args.sortie / "brut"
    files.mkdir(parents=True, exist_ok=True); raw.mkdir(parents=True, exist_ok=True)
    max_bytes = int(args.max_go * 1024**3)

    cat_path = args.sortie / "catalog.json"
    catalog: list[dict] = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else []
    done = {s["id"] for s in catalog}
    total = sum(s["bytes"] for s in catalog)
    similar, hashes = Doublons(), {s["sha1"] for s in catalog}
    for s in catalog:
        similar.add(s["durationMs"], s["peaks"])
    for ref in args.reference:
        doc = json.loads(ref.read_text(encoding="utf-8"))
        for s in (doc["sounds"] if isinstance(doc, dict) else doc):
            similar.add(s.get("durationMs", 0), s.get("peaks") or [])
            if s.get("sha1"):
                hashes.add(s["sha1"])
            done.add(s["id"])
    skipped = {"doublon": 0, "illisible": 0}

    for query, want, code, ucs, cat in QUERIES:
        if total >= max_bytes:
            break
        page = api("/search/text/", {
            "query": query, "page_size": 150, "fields": FIELDS, "sort": "downloads_desc",
            "filter": 'license:"Creative Commons 0" duration:[0.2 TO 20] samplerate:[44100 TO *]',
        })
        added = 0
        for r in page.get("results", []):
            if added >= want or total >= max_bytes:
                break
            sid = f"fs-{r['id']}"
            if sid in done:
                continue
            if r.get("num_ratings", 0) >= 3 and r.get("avg_rating", 0) < 3.5:
                continue  # sons mal notés par la communauté
            done.add(sid)
            src = raw / f"{r['id']}.{r.get('type') or 'wav'}"
            if not download(r["id"], src):
                skipped["illisible"] += 1
                continue
            title = clean_title(r["name"])
            base = f"{code}_{slug(title, 40)}_{sid}"
            try:
                out = convert(src, files, base, probe(src))
            except Exception as e:  # noqa: BLE001  (fichier trop lourd ou corrompu : on passe)
                print(f"    ! conversion impossible ({r['id']}) : {type(e).__name__}", flush=True)
                out = None
            src.unlink(missing_ok=True)
            if not out:
                skipped["illisible"] += 1
                continue
            dest, fmt = out
            dur = int(probe(dest) * 1000)
            peaks, sha1 = peaks_of(dest), pcm_hash(dest)
            size = dest.stat().st_size
            if sha1 in hashes or similar.known(dur, peaks) or total + size > max_bytes:
                skipped["doublon"] += 1
                dest.unlink()
                continue
            hashes.add(sha1); similar.add(dur, peaks)
            en_tags = [t.lower() for t in r.get("tags", []) if 1 < len(t) < 25 and not re.search(r"\d{3,}|freesound|cc0|wav|mp3|recorded", t, re.I)]
            words = re.findall(r"[a-z]+", " ".join([title.lower(), query, *en_tags]))
            fr_tags = sorted({FR[w] for w in words if w in FR and w not in {"step", "drop", "drops"}})
            desc = clean_desc(r.get("description", ""))
            catalog.append({
                "id": sid, "title": title, "titleEn": title,
                "description": desc, "descriptionEn": desc,
                "code": code, "ucs": ucs, "category": cat,
                "tags": list(dict.fromkeys([*fr_tags, query, *en_tags[:8], "youtube", "montage"]))[:14],
                "durationMs": dur, "file": dest.name, "format": fmt,
                "license": "CC0", "author": r["username"], "credit": f"Freesound - {r['username']}",
                "source": "Freesound", "sourceUrl": r.get("url") or f"https://freesound.org/s/{r['id']}/",
                "peaks": peaks, "sha1": sha1, "bytes": size, "pack": f"Freesound · {query}",
            })
            total += size; added += 1
            if added % 10 == 0:
                cat_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
        cat_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
        print(f"« {query} » : +{added} sons · total {len(catalog)} sons, {total/1e6:.0f} Mo", flush=True)

    print(f"\nBILAN : {len(catalog)} sons, {total/1e6:.0f} Mo, ignorés : {skipped}", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
