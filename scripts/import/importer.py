#!/usr/bin/env python3
"""Import de sons libres pour Onde.

Source actuelle : les pages OpenGameArt d'une collection de sons, en ne gardant
que celles dont la licence affichée inclut CC0.

Pour chaque son : téléchargement poli (une requête toutes les 1,5 s), contrôle,
volume normalisé, silence de début retiré, conversion (WAV 48 kHz pour les sons
courts, MP3 320 pour les longs), forme d'onde, catégorie UCS, et traçabilité
complète (source, auteur, licence, lien d'origine, empreinte).

Garde-fous : le script s'arrête dès que MAX_SONS ou MAX_OCTETS est atteint.

Doublons : même son exact (empreinte du signal), ou même son ré-encodé ailleurs (même durée
et même forme d'onde qu'un son déjà dans la bibliothèque en ligne, voir --reference).

Usage :
  python3 scripts/import/importer.py --sortie /chemin/bibliotheque [--collection URL | --pages liste.json]
      [--reference v1.json] [--max-sons 3000] [--max-go 2] [--max-par-page 40] [--purger-cache]
"""
from __future__ import annotations

import argparse
import concurrent.futures as cf
import hashlib
import html
import json
import re
import shutil
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
import zipfile
from pathlib import Path

UA = "OndeImporter/0.1 (+https://ondesound.com; contact.ondesound@gmail.com)"
PAUSE = 1.5  # secondes entre deux requêtes vers un même site
AUDIO_EXT = {".wav", ".ogg", ".mp3", ".flac", ".aif", ".aiff", ".opus", ".m4a"}
COURT_MAX_S = 60      # en dessous : WAV 48 kHz (bruitages) ; au-dessus : MP3 320 (ambiances, musiques)
DUREE_MAX_S = 600     # on ignore les fichiers de plus de 10 minutes
DUREE_MIN_S = 0.05
PEAKS = 120

# Catégories UCS : mots-clés (anglais, puisque les sources le sont) -> (code, catégorie en français)
UCS = [
    (r"\b(8 ?bit|chiptune|retro|arcade|jump|powerup|power up|pickup|coin)\b", "GAME", "Jeu vidéo"),
    (r"\b(ui|click|button|menu|interface|beep|blip|select|confirm|notification|switch|toggle)\b", "UI", "Interface"),
    (r"\b(whoosh|swoosh|swish|woosh|swing|swipe)\b", "WHSH", "Whooshes"),
    (r"\b(door|gate|lock|latch|creak|hinge)\b", "DOOR", "Portes"),
    (r"\b(footstep|footsteps|step|steps|walk|walking|run|running)\b", "FOOT", "Pas"),
    (r"\b(explosion|explode|blast|bomb|boom)\b", "EXPL", "Explosions"),
    (r"\b(gun|shot|gunshot|rifle|pistol|reload|bullet|laser shot)\b", "GUNS", "Armes à feu"),
    (r"\b(sword|blade|knife|weapon|axe|shield|armor|armour)\b", "WEAP", "Armes blanches"),
    (r"\b(punch|hit|impact|slam|thud|knock|bump|smack|crash)\b", "IMPC", "Impacts"),
    (r"\b(rain|thunder|storm|wind|weather)\b", "RAIN", "Pluie & météo"),
    (r"\b(water|splash|drip|liquid|bubble|underwater|river|wave|slime)\b", "WATR", "Eau"),
    (r"\b(fire|flame|burn|fireball)\b", "FIRE", "Feu"),
    (r"\b(magic|spell|enchant|mana|heal|freeze|ice spell)\b", "MAGC", "Magie"),
    (r"\b(monster|creature|growl|roar|zombie|ghost|demon|alien)\b", "CREA", "Créatures"),
    (r"\b(dog|cat|bird|birds|horse|cow|animal|insect|frog|wolf)\b", "ANML", "Animaux"),
    (r"\b(voice|scream|breath|breathing|laugh|cough|grunt|hurt|death|die|yell)\b", "HUMN", "Humain"),
    (r"\b(car|engine|vehicle|motor|train|plane|truck|horn)\b", "VEH", "Véhicules"),
    (r"\b(scifi|sci fi|sci-fi|space|robot|laser|computer|electric|electronic|zap)\b", "SCIF", "Science-fiction"),
    (r"\b(glass|shatter|break|broken)\b", "GLAS", "Verre"),
    (r"\b(metal|clang|chain)\b", "METL", "Métal"),
    (r"\b(wood|wooden|plank|stick)\b", "WOOD", "Bois"),
    (r"\b(paper|book|page|flip|cloth|fabric|rustle|leaves)\b", "FOLY", "Foley"),
    (r"\b(ambience|ambient|atmosphere|forest|city|crowd|room tone|night)\b", "AMB", "Ambiances"),
    (r"\b(music|jingle|melody|loop|song|theme|arpeggio)\b", "MUS", "Musique"),
]

session_last_hit: dict[str, float] = {}


def log(msg: str) -> None:
    print(msg, flush=True)


def fetch(url: str, dest: Path | None = None) -> bytes | None:
    """Téléchargement poli, avec cache sur disque."""
    if dest and dest.exists() and dest.stat().st_size > 0:
        return None
    host = urllib.parse.urlparse(url).netloc
    wait = PAUSE - (time.time() - session_last_hit.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    for attempt in range(3):
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = r.read()
            session_last_hit[host] = time.time()
            if dest:
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_bytes(data)
                return None
            return data
        except Exception as e:  # réseau capricieux : on réessaie doucement
            session_last_hit[host] = time.time()
            if attempt == 2:
                log(f"  ! échec {url} : {e}")
                return b"" if not dest else None
            time.sleep(3 * (attempt + 1))
    return None


def text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", " ", fragment)).strip()


def field(page: str, name: str) -> str:
    i = page.find(f"field-name-{name}")
    if i < 0:
        return ""
    j = page.find('<div class="field field-name', i + 10)
    return page[i : j if j > 0 else i + 6000]


def parse_node(page: str) -> dict:
    title = text(re.search(r"<title>(.*?)</title>", page, re.S).group(1)).replace("| OpenGameArt.org", "").strip()
    lic = field(page, "field-art-licenses")
    licenses = [text(m) for m in re.findall(r"<div class='license-name'>(.*?)</div>", lic)]
    author = text(m.group(1)) if (m := re.search(r"<span class='username'>(.*?)</span>", field(page, "author-submitter"))) else ""
    tags = [text(t) for t in re.findall(r'field_art_tags_tid=[^"]*"[^>]*>(.*?)</a>', field(page, "field-art-tags"))]
    files = re.findall(r'<a href="(https://opengameart\.org/sites/default/files/[^"]+)"', field(page, "field-art-files"))
    art_type = text(field(page, "field-art-type"))
    return {"title": title, "licenses": licenses, "author": author, "tags": tags, "files": files, "type": art_type}


def slug(s: str, n: int = 60) -> str:
    s = unicodedata.normalize("NFKD", s).encode("ascii", "ignore").decode()
    s = re.sub(r"[^A-Za-z0-9]+", "-", s).strip("-")
    return s[:n].strip("-") or "son"


def clean_title(stem: str, pack: str) -> str:
    t = re.sub(r"[_\-.]+", " ", stem)
    t = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", t)          # camelCase -> mots
    t = re.sub(r"\b(sfx|wav|ogg|mp3|final|edit|v\d+)\b", " ", t, flags=re.I)
    t = re.sub(r"\s+", " ", t).strip()
    if not re.search(r"[A-Za-z]{3,}", t):              # nom de fichier sans mots : on reprend le pack
        t = f"{pack} {t}".strip()
    return t[:1].upper() + t[1:]


def categorize(words: str) -> tuple[str, str]:
    w = words.lower().replace("_", " ").replace("-", " ")
    for pattern, code, cat in UCS:
        if re.search(pattern, w):
            return code, cat
    return "MISC", "Divers"


def probe(path: Path) -> float:
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60)
    try:
        return float(out.stdout.strip())
    except ValueError:
        return 0.0


def peaks_of(path: Path) -> list[float]:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "8000", "-f", "s16le", "-"],
                         capture_output=True, stdin=subprocess.DEVNULL, timeout=180).stdout
    n = len(raw) // 2
    if n == 0:
        return [0.0] * PEAKS
    import array
    a = array.array("h"); a.frombytes(raw[: n * 2])
    size = max(1, n // PEAKS)
    p = [max((abs(x) for x in a[i * size:(i + 1) * size]), default=0) for i in range(PEAKS)]
    top = max(p) or 1
    return [round(v / top, 3) for v in p]


def channels(path: Path) -> int:
    out = subprocess.run(["ffprobe", "-v", "error", "-select_streams", "a:0", "-show_entries", "stream=channels", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, stdin=subprocess.DEVNULL, timeout=60)
    try:
        return int(out.stdout.strip().split()[0])
    except (ValueError, IndexError):
        return 2


def convert(src: Path, dest_dir: Path, base: str, duration: float) -> tuple[Path, str] | None:
    short = duration <= COURT_MAX_S
    filters = "silenceremove=start_periods=1:start_threshold=-60dB:start_silence=0.02,loudnorm=I=-18:TP=-1.5:LRA=11"
    # Un son mono reste mono : deux fois moins lourd, et les logiciels de montage le lisent pareil
    ac, layout = ("1", "mono") if channels(src) == 1 else ("2", "stéréo")
    if short:
        dest = dest_dir / f"{base}.wav"
        args = ["-ac", ac, "-ar", "48000", "-c:a", "pcm_s16le"]
        fmt = f"WAV · 48 kHz · 16 bits · {layout}"
    else:
        dest = dest_dir / f"{base}.mp3"
        args = ["-ac", ac, "-ar", "48000", "-c:a", "libmp3lame", "-b:a", "320k" if ac == "2" else "192k"]
        fmt = f"MP3 · {'320' if ac == '2' else '192'} kbps · {layout}"
    r = subprocess.run(["ffmpeg", "-nostdin", "-y", "-v", "error", "-i", str(src), "-af", filters, *args, str(dest)], capture_output=True, stdin=subprocess.DEVNULL, timeout=300)
    if r.returncode != 0 or not dest.exists() or dest.stat().st_size < 512:
        return None
    return dest, fmt


def pcm_hash(path: Path) -> str:
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(path), "-ac", "1", "-ar", "16000", "-f", "s16le", "-"],
                         capture_output=True, stdin=subprocess.DEVNULL, timeout=180).stdout
    return hashlib.sha1(raw).hexdigest()


class Doublons:
    """Repère un son déjà connu sous un autre encodage : durée proche et forme d'onde (120 pics) très corrélée."""

    def __init__(self) -> None:
        self.by_bucket: dict[int, list[tuple[int, list[float]]]] = {}

    def add(self, duration_ms: int, peaks: list[float]) -> None:
        if peaks and duration_ms > 0:
            self.by_bucket.setdefault(duration_ms // 250, []).append((duration_ms, peaks))

    @staticmethod
    def _corr(a: list[float], b: list[float]) -> float:
        n = min(len(a), len(b))
        if n < 8:
            return 0.0
        a, b = a[:n], b[:n]
        ma, mb = sum(a) / n, sum(b) / n
        va = sum((x - ma) ** 2 for x in a); vb = sum((y - mb) ** 2 for y in b)
        if va == 0 or vb == 0:
            return 1.0 if va == vb else 0.0
        return sum((x - ma) * (y - mb) for x, y in zip(a, b)) / (va * vb) ** 0.5

    @staticmethod
    def _gap(a: list[float], b: list[float]) -> float:
        n = min(len(a), len(b))
        return sum(abs(x - y) for x, y in zip(a[:n], b[:n])) / max(1, n)

    def same(self, d1: int, p1: list[float], d2: int, p2: list[float]) -> bool:
        if abs(d1 - d2) > max(30, max(d1, d2) * 0.015):
            return False
        # Les sons très courts se ressemblent tous un peu à cette résolution : critère plus strict
        corr, gap = (0.995, 0.02) if max(d1, d2) < 1500 else (0.98, 0.04)
        return self._gap(p1, p2) <= gap and self._corr(p1, p2) >= corr

    def known(self, duration_ms: int, peaks: list[float]) -> bool:
        k = duration_ms // 250
        for bucket in (k - 1, k, k + 1):
            for d, p in self.by_bucket.get(bucket, []):
                if self.same(d, p, duration_ms, peaks):
                    return True
        return False


def collection_nodes(url: str) -> list[str]:
    page = fetch(url).decode("utf-8", "ignore")
    nodes = sorted(set(re.findall(r'href="(/content/[a-z0-9-]+)"', page)))
    return [f"https://opengameart.org{n}" for n in nodes if n not in ("/content/faq",)]


def process_file(job: dict) -> dict | None:
    src: Path = job["src"]
    sid = hashlib.sha1(f"{job['page']}|{job['rel']}".encode()).hexdigest()[:10]
    if sid in job["known"]:
        return {"skip": True}
    try:
        return _process(job, src, sid)
    except subprocess.TimeoutExpired:
        log(f"  ! trop long, ignoré : {job['rel']}")
        return None


def _process(job: dict, src: Path, sid: str) -> dict | None:
    dur = probe(src)
    if not (DUREE_MIN_S <= dur <= DUREE_MAX_S):
        return None
    title = clean_title(src.stem, job["pack"]["title"])
    code, cat = categorize(" ".join([title, src.stem, job["pack"]["title"], *job["pack"]["tags"]]))
    base = f"{code}_{slug(title, 48)}_{sid}"
    out = convert(src, job["dest"], base, dur)
    if not out:
        return None
    dest, fmt = out
    tags = sorted({t.lower() for t in job["pack"]["tags"] if 1 < len(t) < 30})
    return {
        "id": sid,
        "title": title,
        "code": code,
        "category": cat,
        "tags": tags[:8],
        "durationMs": int(probe(dest) * 1000),
        "file": dest.name,
        "format": fmt,
        "license": "CC0",
        "author": job["pack"]["author"],
        "source": "OpenGameArt",
        "sourceUrl": job["page"],
        "pack": job["pack"]["title"],
        "originalFile": job["rel"],
        "peaks": peaks_of(dest),
        "sha1": pcm_hash(dest),
        "bytes": dest.stat().st_size,
    }


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True, type=Path, help="dossier de la bibliothèque produite")
    ap.add_argument("--cache", type=Path, help="dossier des téléchargements bruts (défaut : <sortie>/../cache)")
    ap.add_argument("--collection", default="https://opengameart.org/content/cc0-sound-effects")
    ap.add_argument("--max-sons", type=int, default=3000)
    ap.add_argument("--max-go", type=float, default=2.0)
    ap.add_argument("--pages", type=Path, help="liste JSON d'adresses de pages OpenGameArt (à la place de --collection)")
    ap.add_argument("--reference", type=Path, action="append", default=[], help="catalogue déjà publié (v1.json) : ses sons comptent comme doublons")
    ap.add_argument("--max-par-page", type=int, default=0, help="nombre maximum de sons gardés par page (0 : pas de limite)")
    ap.add_argument("--purger-cache", action="store_true", help="effacer les téléchargements bruts de chaque page une fois traitée")
    args = ap.parse_args()

    out_dir: Path = args.sortie
    files_dir = out_dir / "sons"
    cache = args.cache or out_dir.parent / "cache"
    files_dir.mkdir(parents=True, exist_ok=True)
    max_bytes = int(args.max_go * 1024**3)

    catalog_path = out_dir / "catalog.json"
    catalog: list[dict] = json.loads(catalog_path.read_text(encoding="utf-8")) if catalog_path.exists() else []
    seen_hash = {s["sha1"] for s in catalog}
    seen_id = {s["id"] for s in catalog}
    total = sum(s["bytes"] for s in catalog)
    skipped = {"licence": 0, "doublon": 0, "quasi-doublon": 0, "illisible": 0}
    similar = Doublons()
    for s in catalog:
        similar.add(s["durationMs"], s["peaks"])
    for ref in args.reference:
        doc = json.loads(ref.read_text(encoding="utf-8"))
        for s in (doc["sounds"] if isinstance(doc, dict) else doc):
            similar.add(s.get("durationMs", 0), s.get("peaks") or [])
            if s.get("sha1"):
                seen_hash.add(s["sha1"])
            seen_id.add(s["id"])
    log(f"{sum(len(v) for v in similar.by_bucket.values())} sons de référence pour les doublons")

    nodes = json.loads(args.pages.read_text(encoding="utf-8")) if args.pages else collection_nodes(args.collection)
    log(f"{len(nodes)} pages dans la collection")
    for n, page_url in enumerate(nodes, 1):
        if len(catalog) >= args.max_sons or total >= max_bytes:
            log("Plafond atteint : arrêt.")
            break
        raw = fetch(page_url)
        if not raw:
            continue
        info = parse_node(raw.decode("utf-8", "ignore"))
        if "CC0" not in info["licenses"]:
            skipped["licence"] += 1
            log(f"[{n}/{len(nodes)}] ignoré (licence {', '.join(info['licenses']) or '?'}) : {info['title']}")
            continue
        if "Sound" not in info["type"] and "Music" not in info["type"]:
            continue
        pack_dir = cache / slug(page_url.rsplit("/", 1)[-1])
        sources: list[tuple[Path, str]] = []
        for f in info["files"]:
            name = urllib.parse.unquote(f.rsplit("/", 1)[-1])
            local = pack_dir / name
            fetch(f, local)
            if not local.exists():
                continue
            if local.suffix.lower() == ".zip":
                target = pack_dir / (local.stem + "_zip")
                if not target.exists():
                    try:
                        with zipfile.ZipFile(local) as z:
                            z.extractall(target)
                    except zipfile.BadZipFile:
                        continue
                for p in sorted(target.rglob("*")):
                    if p.suffix.lower() in AUDIO_EXT and "__MACOSX" not in p.parts and not p.name.startswith("._"):
                        sources.append((p, f"{name}/{p.relative_to(target)}"))
            elif local.suffix.lower() in AUDIO_EXT:
                sources.append((local, name))

        # Pour les packs avec plusieurs formats du même son (ex. .ogg et .wav), on garde le meilleur.
        best: dict[str, tuple[Path, str]] = {}
        rank = {".wav": 0, ".flac": 1, ".aif": 2, ".aiff": 2, ".ogg": 3, ".opus": 4, ".m4a": 5, ".mp3": 6}
        for p, rel in sources:
            key = str(Path(rel).with_suffix("")).lower()
            if key not in best or rank.get(p.suffix.lower(), 9) < rank.get(best[key][0].suffix.lower(), 9):
                best[key] = (p, rel)

        jobs = [{"src": p, "rel": rel, "page": page_url, "pack": info, "dest": files_dir, "known": seen_id} for p, rel in best.values()]
        jobs = jobs[: max(0, args.max_sons - len(catalog))]
        if args.max_par_page:
            jobs = jobs[: args.max_par_page * 2]  # de la marge pour les doublons écartés
        added = 0
        with cf.ThreadPoolExecutor(max_workers=4) as pool:
            for res in pool.map(process_file, jobs):
                if res and res.get("skip"):
                    continue
                if not res:
                    skipped["illisible"] += 1
                    continue
                full = args.max_par_page and added >= args.max_par_page
                near = similar.known(res["durationMs"], res["peaks"])
                if full or near or res["sha1"] in seen_hash or res["id"] in seen_id or total + res["bytes"] > max_bytes:
                    if near:
                        skipped["quasi-doublon"] += 1
                    elif not full:
                        skipped["doublon"] += 1
                    (files_dir / res["file"]).unlink(missing_ok=True)
                    continue
                seen_hash.add(res["sha1"]); seen_id.add(res["id"]); similar.add(res["durationMs"], res["peaks"])
                catalog.append(res); total += res["bytes"]; added += 1
        log(f"[{n}/{len(nodes)}] +{added} sons · {info['title']} ({info['author']}) · total {len(catalog)} sons, {total/1024**2:.0f} Mo")
        catalog_path.write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
        if args.purger_cache:
            shutil.rmtree(pack_dir, ignore_errors=True)

    cats: dict[str, int] = {}
    for s in catalog:
        cats[s["category"]] = cats.get(s["category"], 0) + 1
    log("\nBILAN")
    log(f"  {len(catalog)} sons · {total/1024**2:.0f} Mo · ignorés : {skipped}")
    for c, k in sorted(cats.items(), key=lambda x: -x[1]):
        log(f"  {k:5d}  {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
