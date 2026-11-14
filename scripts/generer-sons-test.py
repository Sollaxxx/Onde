#!/usr/bin/env python3
"""Génère des sons de test (synthétisés avec ffmpeg, donc libres de droits)
et le catalogue JSON utilisé par le prototype.

Usage : python3 scripts/generer-sons-test.py
Sortie : src-tauri/resources/samples/*.wav + catalog.json
"""
import json
import struct
import subprocess
import sys
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "src-tauri" / "resources" / "samples"
RATE = 48000
PEAKS = 120

# id, titre, code UCS, catégorie, mots-clés, durée (s), source ffmpeg, filtres
SOUNDS = [
    ("whsh-rapide", "Whoosh rapide, métallique", "WHSH", "Whooshes", ["transition", "rapide", "passage"], 1.4,
     "anoisesrc=d={d}:c=white:a=0.6", "highpass=f=900,lowpass=f=7000,afade=t=in:d=0.6:curve=exp,afade=t=out:st=0.6:d=0.8:curve=exp"),
    ("whsh-grave", "Whoosh grave, passage lent", "WHSH", "Whooshes", ["lent", "grave", "vent"], 2.4,
     "anoisesrc=d={d}:c=brown:a=0.9", "lowpass=f=900,afade=t=in:d=1.0:curve=exp,afade=t=out:st=1.0:d=1.4:curve=exp"),
    ("impc-sourd", "Impact sourd, cinématique", "IMPC", "Impacts", ["bande-annonce", "basse", "boom"], 2.5,
     "aevalsrc=0.9*sin(2*PI*(45*t+13*(1-exp(-6*t))))*exp(-2.2*t):d={d}:s=48000", ""),
    ("impc-metal", "Impact métallique court", "IMPC", "Impacts", ["métal", "coup", "industriel"], 1.6,
     "aevalsrc=0.35*(sin(2*PI*420*t)+sin(2*PI*1130*t)+0.6*sin(2*PI*2210*t))*exp(-5*t):d={d}:s=48000", ""),
    ("ui-clic", "Clic d'interface doux", "UI", "Interface", ["bouton", "clic", "minimal"], 0.3,
     "aevalsrc=0.7*sin(2*PI*1800*t)*exp(-90*t):d={d}:s=48000", ""),
    ("ui-notif", "Notification, deux notes", "UI", "Interface", ["notification", "alerte", "message"], 0.9,
     "aevalsrc=0.5*(lt(t\\,0.3)*sin(2*PI*880*t)*exp(-8*t)+gte(t\\,0.3)*sin(2*PI*1320*t)*exp(-6*(t-0.3))):d={d}:s=48000", ""),
    ("rain-tole", "Pluie sur un toit de tôle", "RAIN", "Pluie & météo", ["pluie", "toit", "ambiance"], 8.0,
     "anoisesrc=d={d}:c=pink:a=0.5", "highpass=f=1200,lowpass=f=8000,tremolo=f=11:d=0.25,afade=t=in:d=1,afade=t=out:st=7:d=1"),
    ("wind-plaine", "Vent continu, plaine", "WIND", "Pluie & météo", ["vent", "extérieur", "calme"], 8.0,
     "anoisesrc=d={d}:c=brown:a=0.9", "lowpass=f=500,tremolo=f=0.3:d=0.6,afade=t=in:d=1.5,afade=t=out:st=6.5:d=1.5"),
    ("door-grince", "Porte en bois qui grince", "DOOR", "Portes", ["grincement", "maison", "horreur"], 4.0,
     "aevalsrc=0.35*sin(2*PI*(300*t+25*sin(2*PI*0.7*t))+3*sin(2*PI*45*t))*(0.6+0.4*sin(2*PI*9*t)):d={d}:s=48000",
     "afade=t=in:d=0.4,afade=t=out:st=3.3:d=0.7"),
    ("door-claque", "Porte qui claque", "DOOR", "Portes", ["claquement", "bois", "intérieur"], 1.5,
     "aevalsrc=0.8*sin(2*PI*(70*t+8*(1-exp(-12*t))))*exp(-7*t)+0.4*(random(0)*2-1)*exp(-40*t):d={d}:s=48000", "lowpass=f=2500"),
    ("foot-gravier", "Pas sur gravier", "FOOT", "Foley", ["pas", "marche", "extérieur"], 5.0,
     "aevalsrc=0.7*(random(0)*2-1)*exp(-28*mod(t\\,0.55)):d={d}:s=48000", "lowpass=f=3500,highpass=f=250"),
    ("humn-coeur", "Battement de cœur, tension", "HUMN", "Humain", ["cœur", "tension", "suspense"], 5.0,
     "aevalsrc=0.9*sin(2*PI*55*t)*(exp(-25*mod(t\\,0.9))+0.7*exp(-25*mod(t-0.22\\,0.9))*gte(t\\,0.22)):d={d}:s=48000", "lowpass=f=300"),
    ("dsgn-drone", "Drone sombre, suspense", "DSGN", "Design sonore", ["drone", "sombre", "nappe"], 8.0,
     "aevalsrc=0.3*(sin(2*PI*55*t)+0.7*sin(2*PI*82.5*t)+0.3*sin(2*PI*110.4*t))*(0.7+0.3*sin(2*PI*0.25*t)):d={d}:s=48000",
     "afade=t=in:d=2,afade=t=out:st=6:d=2"),
    ("dsgn-riser", "Montée de tension (riser)", "DSGN", "Design sonore", ["riser", "montée", "transition"], 4.0,
     "aevalsrc=0.4*sin(2*PI*(200*t+125*t*t))*(t/4):d={d}:s=48000", "afade=t=out:st=3.85:d=0.15"),
    ("elec-radio", "Grésillement radio", "ELEC", "Électrique", ["radio", "parasite", "interférence"], 3.0,
     "anoisesrc=d={d}:c=white:a=0.5", "bandpass=f=2200:w=1800,tremolo=f=7:d=0.7,afade=t=in:d=0.2,afade=t=out:st=2.6:d=0.4"),
    ("clok-tictac", "Tic-tac d'horloge", "CLOK", "Horloges", ["horloge", "temps", "attente"], 4.0,
     "aevalsrc=0.6*sin(2*PI*(2500-900*eq(mod(floor(t*2)\\,2)\\,1))*t)*exp(-150*mod(t\\,0.5)):d={d}:s=48000", ""),
]


def read_peaks(path: Path) -> list:
    with wave.open(str(path), "rb") as w:
        n = w.getnframes()
        ch = w.getnchannels()
        raw = w.readframes(n)
    samples = struct.unpack("<%dh" % (len(raw) // 2), raw)
    mono = [abs(samples[i]) for i in range(0, len(samples), ch)]
    size = max(1, len(mono) // PEAKS)
    peaks = [max(mono[i * size:(i + 1) * size] or [0]) for i in range(PEAKS)]
    top = max(peaks) or 1
    return [round(p / top, 3) for p in peaks]


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    catalog = []
    for sid, title, code, cat, tags, dur, src, flt in SOUNDS:
        dest = OUT / f"{sid}.wav"
        cmd = ["ffmpeg", "-y", "-loglevel", "error", "-f", "lavfi", "-i", src.format(d=dur)]
        filters = ",".join(x for x in [flt, "loudnorm=I=-18:TP=-1.5", "aresample=48000"] if x)
        cmd += ["-af", filters, "-ac", "2", "-ar", str(RATE), "-c:a", "pcm_s16le", "-t", str(dur), str(dest)]
        subprocess.run(cmd, check=True)
        catalog.append({
            "id": sid,
            "title": title,
            "code": code,
            "category": cat,
            "tags": tags,
            "durationMs": int(dur * 1000),
            "file": dest.name,
            "format": "WAV · 48 kHz · 16 bits · stéréo",
            "license": "CC0 · son de test généré",
            "peaks": read_peaks(dest),
        })
        print(f"ok  {code:5} {title}")
    (OUT / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(catalog)} sons -> {OUT}")


if __name__ == "__main__":
    sys.exit(main())
