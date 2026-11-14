#!/usr/bin/env python3
"""Catalogue des sons CC0 de BigSoundBank / La Sonothèque (Joseph Sardin).

Lit uniquement les pages publiques de résultats (titres anglais et français,
description, sous-catégorie UCS, durée), sans rien télécharger d'audio.
Utilisé avec l'accord de l'auteur : crédit « BigSoundBank - Joseph Sardin » + lien vers la page du son.

Usage : python3 scripts/import/bigsoundbank_catalogue.py --sortie catalogue_bsb.json
"""
from __future__ import annotations

import argparse
import html
import json
import re
import time
import urllib.request

UA = "OndeImporter/0.1 (+https://onde-nis.pages.dev; contact.ondesound@gmail.com)"
PAUSE = 1.5
ENTRY = re.compile(
    r"<h2[^>]*>\s*<a href='(/[^']*-s(\d+)\.html)'>(.*?)</a>.*?"
    r"<div>(.*?)<a href='/categories\.html'>[^<]*</a>\s*:\s*<a href='/search\?CatID=([A-Za-z]+)'>.*?"
    r"(?:Length|Durée)\s*:\s*([0-9:]+)",
    re.S,
)


def get(url: str) -> str:
    time.sleep(PAUSE)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.read().decode("utf-8", "ignore")


def clean(s: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", s))).strip()


def seconds(length: str) -> int:
    parts = [int(p) for p in length.split(":")]
    total = 0
    for p in parts:
        total = total * 60 + p
    return total


def scan(base: str) -> dict[str, dict]:
    out: dict[str, dict] = {}
    first = get(f"{base}/search?q=&droit=libre&tri=r")
    last = max(int(p) for p in re.findall(r"page=(\d+)", first) or ["1"])
    for page in range(1, last + 1):
        t = first if page == 1 else get(f"{base}/search?q=&droit=libre&tri=r&page={page}")
        for url, sid, title, desc, cat, length in ENTRY.findall(t):
            out[sid] = {"url": base + url, "title": clean(title), "desc": clean(desc).rstrip(" ."), "ucs": cat, "seconds": seconds(length)}
        print(f"{base} page {page}/{last} : {len(out)} sons", flush=True)
    return out


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--sortie", required=True)
    args = ap.parse_args()
    en = scan("https://bigsoundbank.com")
    fr = scan("https://lasonotheque.org")
    sounds = []
    for sid, e in sorted(en.items()):
        f = fr.get(sid, {})
        sounds.append({
            "id": f"bsb-{sid}",
            "bsbId": sid,
            "titleEn": e["title"],
            "titleFr": f.get("title", ""),
            "descEn": e["desc"],
            "descFr": f.get("desc", ""),
            "ucs": e["ucs"],
            "durationS": e["seconds"],
            "sourceUrl": e["url"],
            "sourceUrlFr": f.get("url", ""),
            "author": "Joseph Sardin",
            "source": "BigSoundBank",
            "credit": "BigSoundBank - Joseph Sardin",
            "license": "CC0",
        })
    with open(args.sortie, "w", encoding="utf-8") as fh:
        json.dump(sounds, fh, ensure_ascii=False, indent=1)
    print(f"{len(sounds)} sons catalogués ({sum(1 for s in sounds if s['titleFr'])} avec titre français)")


if __name__ == "__main__":
    main()
