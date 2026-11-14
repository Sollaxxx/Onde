#!/usr/bin/env python3
"""Import des sons CC0 de BigSoundBank (Joseph Sardin) dans la bibliothèque Onde.

Utilisé avec l'accord de l'auteur. Chaque son est crédité
« BigSoundBank - Joseph Sardin », avec un lien vers sa page d'origine.

Le script reste au rythme d'un visiteur ordinaire : une seule page de 40 sons
à la fois (format WAV d'origine), avec une pause entre deux pages.

Entrée : data/sources/bigsoundbank.json (créé par bigsoundbank_catalogue.py)
Sortie : <sortie>/sons/*.wav|mp3 + <sortie>/catalog.json

Usage :
  python3 scripts/import/bigsoundbank_import.py --sortie DOSSIER [--pages 1-90] [--pause 30] [--max-go 8]
"""
from __future__ import annotations

import argparse
import array
import http.cookiejar
import concurrent.futures as cf
import hashlib
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

UA = "OndeImporter/0.1 (+https://onde-nis.pages.dev; contact.ondesound@gmail.com)"
SITE = "https://bigsoundbank.com"
PAR_PAGE = 40
COURT_MAX_S = 30     # WAV 48 kHz jusqu'à 30 s, MP3 320 au-delà
DUREE_MAX_S = 600    # les sons de plus de 10 minutes sont laissés de côté
PEAKS = 120

# Catégories UCS -> nom affiché en français
CATEGORIES = {
    "AERO": "Avions", "WING": "Ailes", "AIR": "Air", "ALRM": "Alarmes", "AMB": "Ambiances", "ANML": "Animaux",
    "GUN": "Armes à feu", "WEAP": "Armes blanches", "FRWK": "Feux d'artifice", "HORN": "Klaxons", "BLLT": "Balles",
    "BOAT": "Bateaux", "BEEP": "Bips", "WOOD": "Bois", "FOLY": "Foley", "RUBR": "Caoutchouc", "TOON": "Cartoon",
    "CERM": "Céramique", "CHAIN": "Chaînes", "BELL": "Cloches", "FGHT": "Combat", "COM": "Communications",
    "ROPE": "Cordes", "CREA": "Créatures", "DSGN": "Design sonore", "WATR": "Eau", "ELEC": "Électricité",
    "EQUIP": "Équipement", "EXPL": "Explosions", "WNDW": "Fenêtres", "FIRE": "Feu", "CRWD": "Foules", "ICE": "Glace",
    "GORE": "Gore", "CLOCK": "Horloges", "HMN": "Humain", "UI": "Interface", "GAME": "Jeux", "TOY": "Jouets",
    "LASR": "Lasers", "LIQ": "Liquides et boue", "MACH": "Machines", "MECH": "Mécanique", "METL": "Métal",
    "WTHR": "Météo", "MOTR": "Moteurs", "MOVE": "Mouvement", "MUSC": "Musique et instruments", "SNOW": "Neige",
    "FOOD": "Nourriture et boissons", "OBJ": "Objets", "BIRD": "Oiseaux", "CMPT": "Ordinateurs", "TOOL": "Outils",
    "PAPR": "Papier", "FEET": "Pas", "FART": "Pets", "PLAS": "Plastique", "RAIN": "Pluie", "DOOR": "Portes",
    "ROBT": "Robots", "ROCK": "Rochers", "DIRT": "Terre et sable", "SCI": "Science-fiction", "WHST": "Sifflets",
    "SPRT": "Sports", "SWSH": "Whooshes", "DRWR": "Tiroirs", "CLOTH": "Tissus", "TRN": "Trains", "VEGE": "Végétation",
    "VEH": "Véhicules", "WIND": "Vent", "GLAS": "Verre", "VOX": "Voix",
}
STOP = set("de du des la le les un une et en à au aux sur dans avec pour par d l the a an of and in on with for to at by".split())

last_hit = 0.0
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(http.cookiejar.CookieJar()))


def log(msg: str) -> None:
    print(msg, flush=True)


def request(url: str, data: dict | None = None, pause: float = 2.0) -> bytes:
    """Une requête à la fois, espacée d'au moins `pause` secondes, comme un visiteur."""
    global last_hit
    wait = pause - (time.time() - last_hit)
    if wait > 0:
        time.sleep(wait)
    body = urllib.parse.urlencode(data).encode() if data is not None else None
    req = urllib.request.Request(url, data=body, headers={"User-Agent": UA, "Referer": f"{SITE}/search"})
    for attempt in range(3):
        try:
            with opener.open(req, timeout=900) as r:
                out = r.read()
            last_hit = time.time()
            return out
        except Exception as e:
            last_hit = time.time()
            if attempt == 2:
                raise
            log(f"  réseau : {e}, nouvel essai dans 30 s")
            time.sleep(30)
    return b""


def download_zip(ids: list[str]) -> bytes:
    """Parcours normal : page d'attente, 10 secondes, puis téléchargement."""
    files = "," + ",".join(ids)
    page = request(f"{SITE}/download.php", {"format": "wav", "files": files}).decode("utf-8", "ignore")
    form = re.search(r'<form id="dl-form-multi" action="([^"]+)".*?</form>', page, re.S)
    if not form:
        raise RuntimeError("page de téléchargement inattendue")
    fields = dict(re.findall(r'<input type="hidden" name="([^"]+)" value="([^"]*)"', form.group(0)))
    fields["antibot_hp"] = ""  # champ laissé vide, comme dans un navigateur
    delay = int(m.group(1)) if (m := re.search(r"var delaiMs = (\d+) \* 1000", page)) else 10
    time.sleep(delay + 1)       # on attend le compte à rebours affiché aux visiteurs
    return request(urllib.parse.urljoin(SITE, form.group(1)), fields, pause=0)


def run(cmd: list[str], timeout: int = 300) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, stdin=subprocess.DEVNULL, timeout=timeout)


def peaks_of(path: Path) -> list[float]:
    raw = run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"]).stdout
    a = array.array("h"); a.frombytes(raw[: len(raw) // 2 * 2])
    if not a:
        return [0.0] * PEAKS
    size = max(1, len(a) // PEAKS)
    p = [max((abs(x) for x in a[i * size:(i + 1) * size]), default=0) for i in range(PEAKS)]
    top = max(p) or 1
    return [round(v / top, 3) for v in p]


def slug(s: str, n: int = 48) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    return re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")[:n].strip("-") or "son"


def main_code(ucs: str) -> str:
    m = re.match(r"^([A-Z]+?)([A-Z][a-z].*)?$", ucs)
    code = m.group(1) if m else ucs
    return code if code in CATEGORIES else next((k for k in CATEGORIES if ucs.startswith(k)), code)


def tags_of(meta: dict) -> list[str]:
    words = re.findall(r"[a-zà-ÿœ]{3,}", (meta["titleFr"] + " " + meta["titleEn"]).lower())
    return sorted({w for w in words if w not in STOP})[:10]


def process(src: Path, meta: dict, dest_dir: Path) -> dict | None:
    dur = meta["durationS"]
    code = main_code(meta["ucs"])
    base = f"{code}_{slug(meta['titleFr'] or meta['titleEn'])}_{meta['bsbId']}"
    if dur <= COURT_MAX_S:
        dest = dest_dir / f"{base}.wav"
        args = ["-ac", "2", "-ar", "48000", "-c:a", "pcm_s16le"]
        fmt = "WAV · 48 kHz · 16 bits · stéréo"
    else:
        dest = dest_dir / f"{base}.mp3"
        args = ["-ac", "2", "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k"]
        fmt = "MP3 · 320 kbps · stéréo"
    # Pas de traitement du son : les enregistrements de Joseph sont déjà montés et réglés.
    r = run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), *args, str(dest)])
    if r.returncode != 0 or not dest.exists():
        return None
    pcm = run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(dest), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"]).stdout
    return {
        "id": meta["id"],
        "title": meta["titleFr"] or meta["titleEn"],
        "titleEn": meta["titleEn"],
        "description": meta["descFr"],
        "descriptionEn": meta["descEn"],
        "code": code,
        "ucs": meta["ucs"],
        "category": CATEGORIES.get(code, code.title()),
        "tags": tags_of(meta),
        "durationMs": int(len(pcm) / 2 / 16000 * 1000) or dur * 1000,
        "file": dest.name,
        "format": fmt,
        "license": "CC0",
        "author": meta["author"],
        "credit": meta["credit"],
        "source": meta["source"],
        "sourceUrl": meta["sourceUrlFr"] or meta["sourceUrl"],
        "sourceUrlEn": meta["sourceUrl"],
        "peaks": peaks_of(dest),
        "sha1": hashlib.sha1(pcm).hexdigest(),
        "bytes": dest.stat().st_size,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--catalogue", type=Path, default=Path(__file__).resolve().parents[2] / "data/sources/bigsoundbank.json")
    ap.add_argument("--sortie", type=Path, required=True)
    ap.add_argument("--pages", default="1-999", help="ex. 1-1 pour un test")
    ap.add_argument("--pause", type=float, default=30.0, help="secondes entre deux pages")
    ap.add_argument("--max-go", type=float, default=8.0)
    args = ap.parse_args()

    metas = [m for m in json.loads(args.catalogue.read_text(encoding="utf-8")) if m["durationS"] <= DUREE_MAX_S]
    metas.sort(key=lambda m: m["bsbId"])
    batches = [metas[i:i + PAR_PAGE] for i in range(0, len(metas), PAR_PAGE)]
    first, last = (int(x) for x in args.pages.split("-"))
    files_dir = args.sortie / "sons"
    files_dir.mkdir(parents=True, exist_ok=True)
    cat_path = args.sortie / "catalog.json"
    catalog = json.loads(cat_path.read_text(encoding="utf-8")) if cat_path.exists() else []
    done = {s["id"] for s in catalog}
    total = sum(s["bytes"] for s in catalog)
    max_bytes = int(args.max_go * 1024**3)
    log(f"{len(metas)} sons à importer en {len(batches)} pages · déjà faits : {len(done)}")

    for n, batch in enumerate(batches, 1):
        if n < first or n > last:
            continue
        todo = [m for m in batch if m["id"] not in done]
        if not todo:
            continue
        if total >= max_bytes:
            log("Plafond de taille atteint : arrêt.")
            break
        t0 = time.time()
        try:
            data = download_zip([m["bsbId"] for m in todo])
            zpath = args.sortie / "_page.zip"
            zpath.write_bytes(data)
            size_mb = len(data) / 1024**2
            del data
            z = zipfile.ZipFile(zpath)
        except Exception as e:
            log(f"[page {n}/{len(batches)}] échec du téléchargement : {e}")
            time.sleep(args.pause)
            continue
        tmp = args.sortie / "_tmp"
        tmp.mkdir(exist_ok=True)
        by_id: dict[str, Path] = {}
        for info in z.infolist():
            m = re.search(r"\(ID (\d+)\)", Path(info.filename).name)
            if m and not info.is_dir():
                p = tmp / Path(info.filename).name
                with z.open(info) as src, open(p, "wb") as out:
                    while chunk := src.read(1 << 20):
                        out.write(chunk)
                by_id[m.group(1).zfill(4)] = p
        added, missing = 0, 0
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            futures = {pool.submit(process, by_id[m["bsbId"]], m, files_dir): m for m in todo if m["bsbId"] in by_id}
            missing = len(todo) - len(futures)
            for f in cf.as_completed(futures):
                try:
                    res = f.result()
                except Exception as e:
                    log(f"  ! {futures[f]['titleFr']} : {e}")
                    continue
                if res:
                    catalog.append(res); done.add(res["id"]); total += res["bytes"]; added += 1
        z.close()
        zpath.unlink(missing_ok=True)
        for p in tmp.iterdir():
            p.unlink()
        cat_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
        log(f"[page {n}/{len(batches)}] +{added} sons ({missing} absents du zip) · zip {size_mb:.0f} Mo en {time.time()-t0:.0f} s · total {len(catalog)} sons, {total/1024**3:.2f} Go")
        time.sleep(args.pause)

    log(f"\nBILAN : {len(catalog)} sons · {total/1024**3:.2f} Go")
    return 0


if __name__ == "__main__":
    sys.exit(main())
