#!/usr/bin/env python3
"""Import des sons de la galerie sonore des parcs nationaux américains (NPS).

Les œuvres du gouvernement fédéral américain sont dans le domaine public. On ne garde
que les sons dont la page indique « Credit / Author: NPS » : un son crédité à une
autre personne ou organisation est ignoré, car il peut avoir une autre licence.

Même traitement que importer.py : volume normalisé, conversion, forme d'onde, empreinte.

Usage :
  python3 scripts/import/nps_import.py --sortie /chemin/bibliotheque
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import importer as imp  # noqa: E402

GALLERY = "https://www.nps.gov/subjects/sound/gallery.htm"
BASE = "https://www.nps.gov"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True, type=Path)
    args = ap.parse_args()
    out = args.sortie; files = out / "sons"; cache = out.parent / "cache-nps"
    files.mkdir(parents=True, exist_ok=True); cache.mkdir(parents=True, exist_ok=True)
    cat_path = out / "catalog.json"
    catalog: list[dict] = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else []
    known = {s["id"] for s in catalog}; hashes = {s["sha1"] for s in catalog}

    page = imp.fetch(GALLERY).decode("utf-8", "ignore")
    pages = sorted(set(re.findall(r'href="(/subjects/sound/sounds-[a-z0-9-]+\.htm)"', page)))
    imp.log(f"{len(pages)} pages de sons")
    skipped = {"crédit": 0, "sans fichier": 0, "illisible": 0, "doublon": 0}
    for n, rel in enumerate(pages, 1):
        url = BASE + rel
        html_page = (imp.fetch(url) or b"").decode("utf-8", "ignore")
        credit = imp.text(m.group(1)) if (m := re.search(r"Credit / Author:\s*</[^>]+>\s*(?:<[^>]+>\s*)*([^<]+)", html_page)) else ""
        if not credit:  # autre mise en page : on cherche le texte brut
            m = re.search(r"Credit / Author:\s*([^<\n]+)", imp.text(html_page))
            credit = m.group(1).strip() if m else ""
        if not re.fullmatch(r"(NPS|National Park Service)\b.*", credit or ""):
            skipped["crédit"] += 1
            imp.log(f"[{n}/{len(pages)}] ignoré (crédit : {credit or '?'}) {rel}")
            continue
        srcs = re.findall(r'src="(https?://www\.nps\.gov/[^"]+\.(?:mp3|wav|m4a))"', html_page)
        if not srcs:
            skipped["sans fichier"] += 1
            continue
        title = re.sub(r"^Sound Gallery - |\s*-\s*Natural Sounds.*$", "", imp.text(re.search(r"<title>(.*?)</title>", html_page, re.S).group(1))).strip()
        for k, src_url in enumerate(srcs):
            local = cache / src_url.rsplit("/", 1)[-1]
            imp.fetch(src_url, local)
            if not local.exists():
                continue
            name = title if len(srcs) == 1 else f"{title} {k + 1}"
            job = {"src": local, "rel": src_url, "page": url, "dest": files, "known": known,
                   "pack": {"title": name, "tags": ["nature", "national park"] + title.lower().split()[:3], "author": "National Park Service"}}
            sid = hashlib.sha1(f"{url}|{src_url}".encode()).hexdigest()[:10]
            if sid in known:
                continue
            res = imp._process(job, local, sid)
            if not res:
                skipped["illisible"] += 1
                continue
            if res["sha1"] in hashes:
                skipped["doublon"] += 1
                (files / res["file"]).unlink(missing_ok=True)
                continue
            res["title"] = name
            res.update({"license": "Domaine public", "author": "National Park Service", "source": "NPS", "credit": "National Park Service"})
            catalog.append(res); known.add(sid); hashes.add(res["sha1"])
            imp.log(f"[{n}/{len(pages)}] + {name} ({res['category']}, {res['durationMs'] / 1000:.1f} s)")
        cat_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    imp.log(f"\n{len(catalog)} sons · ignorés : {skipped}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
