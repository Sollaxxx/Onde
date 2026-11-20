#!/usr/bin/env python3
"""Import du pack « SFX Kit » de Wyzowl (github.com/wyzowl/sfx-kit, CC0) : 320 sons pour la vidéo.

Risers, booms et sub drops, impacts cinéma, whooshes, logo stings, pops, glitches, notifications…
Les fichiers sont gardés tels quels (WAV 48 kHz 24 bits, déjà calibrés en volume par l'auteur).
Titres traduits en français, catégories alignées sur celles de la bibliothèque, doublons écartés
(empreinte exacte et quasi-doublons, comme importer.py).

Usage :
  git clone --depth 1 https://github.com/wyzowl/sfx-kit
  python3 scripts/import/sfxkit_import.py --kit sfx-kit --sortie DOSSIER --reference v1.json
"""
from __future__ import annotations

import argparse
import json
import re
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from importer import Doublons, channels, pcm_hash, peaks_of, probe  # noqa: E402
from finaliser import FR  # noqa: E402

SOURCE_URL = "https://github.com/wyzowl/sfx-kit"

# Catégorie du kit → (code, UCS, catégorie de la bibliothèque)
CATS = {
    "whooshes": ("SWSH", "SWSHWhsh", "Whooshes"), "swishes-and-zips": ("SWSH", "SWSHSwsh", "Whooshes"),
    "swipes": ("SWSH", "SWSHSwsh", "Whooshes"), "reverse-whooshes": ("SWSH", "SWSHWhsh", "Whooshes"),
    "risers-and-fallers": ("DSGN", "DSGNRise", "Design sonore"), "cinematic-hits": ("DSGN", "DSGNImpt", "Design sonore"),
    "booms-and-bass": ("DSGN", "DSGNBoom", "Design sonore"), "logo-stings": ("DSGN", "DSGNStngr", "Design sonore"),
    "bounce-spin-zoom": ("TOON", "TOONMisc", "Cartoon"), "pops": ("TOON", "TOONPop", "Cartoon"),
    "shape-changes": ("TOON", "TOONMisc", "Cartoon"), "appear-and-vanish": ("MAGC", "MAGCMisc", "Magie"),
    "shimmers": ("MAGC", "MAGCShim", "Magie"), "impacts": ("IMPC", "IMPCMisc", "Impacts"),
    "interface": ("UI", "UIClick", "Interface"), "notifications": ("UI", "UIAlert", "Interface"),
    "tones": ("UI", "UIMisc", "Interface"), "data": ("UI", "UIData", "Interface"),
    "keyboard": ("CMPT", "COMPKeyb", "Ordinateurs"), "digital": ("CMPT", "COMPMisc", "Ordinateurs"),
    "writing-and-drawing": ("PAPR", "PAPRWrite", "Papier"), "phone": ("COM", "COMTelph", "Communications"),
    "mechanical": ("MECH", "MECHMisc", "Mécanique"), "foley": ("FOLY", "FOLYProp", "Foley"),
    "everyday-props": ("OBJ", "OBJMisc", "Objets"), "money": ("OBJ", "OBJCoin", "Objets"),
    "time": ("CLOCK", "CLOCKMech", "Horloges"), "celebration": ("CRWD", "CRWDApls", "Foules"),
}

# Nom (avant la première virgule) → (titre français, féminin ?)
HEADS = {
    "Whoosh": ("Whoosh", False), "Swish": ("Swish", False), "Zip in": ("Zip d'entrée", False), "Zip out": ("Zip de sortie", False),
    "Swipe": ("Balayage au doigt", False), "Reverse whoosh": ("Whoosh inversé", False), "Faller": ("Descente", True),
    "Riser": ("Montée", True), "Ball bouncing": ("Balle qui rebondit", True), "Spin": ("Rotation", True),
    "Spring boing": ("Ressort « boing »", False), "Zoom in": ("Zoom avant", False), "Zoom out": ("Zoom arrière", False),
    "Impact": ("Impact", False), "Cinematic drum hit": ("Frappe de tambour cinéma", True),
    "Cinematic metal hit": ("Frappe métallique cinéma", True), "Cinematic slam": ("Claquement cinéma", False),
    "Cinematic thunderclap": ("Coup de tonnerre cinéma", False), "808-style bass": ("Basse 808", True),
    "Rumble": ("Grondement", False), "Sub drop": ("Sub drop", False), "Boom drop": ("Boom drop", False), "Boom hit": ("Boom", False),
    "Bubble pop": ("Bulle qui éclate", True), "Pop in": ("Pop d'apparition", False), "Pop out": ("Pop de disparition", False),
    "Burst": ("Éclatement", False), "Dissolve": ("Dissolution", True), "Flip": ("Retournement", False), "Materialise": ("Apparition", True),
    "Poof": ("Pouf de fumée", False), "Deflate": ("Dégonflement", False), "Empty": ("Vidage", False), "Fill": ("Remplissage", False),
    "Grow": ("Agrandissement", False), "Inflate": ("Gonflement", False), "Morph": ("Transformation", True), "Shrink": ("Rétrécissement", False),
    "Stretch": ("Étirement", False), "Button click": ("Clic de bouton", False), "Hand clap": ("Claquement de mains", False),
    "Spring clip": ("Pince à ressort", True), "Hover tick": ("Tic de survol", False), "Push latch": ("Loquet poussoir", False),
    "Mouse click": ("Clic de souris", False), "Rocker switch": ("Interrupteur à bascule", False), "Finger snap": ("Claquement de doigts", False),
    "Tap": ("Tapotement", False), "Toggle switch": ("Interrupteur", False), "Toggle off": ("Désactivation", True), "Toggle on": ("Activation", True),
    "Letter key": ("Touche lettre", True), "Return key": ("Touche Entrée", True), "Space bar": ("Barre d'espace", True),
    "Typing": ("Frappe au clavier", True), "Chalk drawing": ("Dessin à la craie", False), "Chalk tick": ("Coche à la craie", True),
    "Chalk writing": ("Écriture à la craie", True), "Eraser": ("Gomme", True), "Highlighter": ("Surligneur", False),
    "Whiteboard marker drawing": ("Dessin au feutre sur tableau blanc", False), "Whiteboard marker tick": ("Coche au feutre sur tableau blanc", True),
    "Whiteboard marker writing": ("Écriture au feutre sur tableau blanc", True), "Pen drawing": ("Dessin au stylo", False),
    "Pen tick": ("Coche au stylo", True), "Pen writing": ("Écriture au stylo", True), "Pencil drawing": ("Dessin au crayon", False),
    "Pencil tick": ("Coche au crayon", True), "Pencil writing": ("Écriture au crayon", True), "Scribble": ("Gribouillis", False),
    "Whiteboard wipe": ("Effacement du tableau blanc", False), "Keypad tones": ("Tonalités de clavier téléphonique", True),
    "Classic phone ring": ("Sonnerie de téléphone classique", True), "Ringtone": ("Sonnerie de portable", True),
    "Phone vibrating in the hand": ("Téléphone qui vibre dans la main", False), "Phone vibrating on a table": ("Téléphone qui vibre sur une table", False),
    "Latch": ("Loquet", False), "Lock": ("Serrure", True), "Ratchet": ("Cliquet", False), "Shutter": ("Obturateur", False),
    "Slider": ("Curseur", False), "Switch": ("Interrupteur", False), "Card slide": ("Carte qui glisse", True), "Card touch": ("Carte posée", True),
    "Fabric slide": ("Tissu qui glisse", False), "Fabric touch": ("Tissu touché", False), "Glass slide": ("Verre qui glisse", False),
    "Glass touch": ("Verre posé", False), "Paper slide": ("Papier qui glisse", False), "Paper touch": ("Papier touché", False),
    "Plastic slide": ("Plastique qui glisse", False), "Plastic touch": ("Plastique touché", False), "Wood slide": ("Bois qui glisse", False),
    "Wood touch": ("Bois touché", False), "Book closing": ("Livre qu'on ferme", False), "Box opening": ("Boîte qu'on ouvre", True),
    "Doorbell": ("Sonnette", True), "Drips": ("Gouttes", True), "Page turn": ("Page qu'on tourne", True), "Scissors": ("Ciseaux", False),
    "Shop door bell": ("Clochette de magasin", True), "Splash": ("Éclaboussure", True), "Tape off the roll": ("Ruban adhésif qu'on déroule", False),
    "Zip": ("Fermeture éclair", True), "Alert": ("Alerte", True), "Attention": ("Attention", True), "Error": ("Erreur", True),
    "Failure": ("Échec", False), "Message arriving": ("Message reçu", False), "Message sent": ("Message envoyé", False),
    "Success": ("Succès", False), "Ding": ("Ding", False), "Step 1 of 5": ("Étape 1 sur 5", True), "Step 2 of 5": ("Étape 2 sur 5", True),
    "Step 3 of 5": ("Étape 3 sur 5", True), "Step 4 of 5": ("Étape 4 sur 5", True), "Step 5 of 5": ("Étape 5 sur 5", True),
    "Shimmer": ("Scintillement", False), "Logo sting": ("Jingle de logo", False), "Applause": ("Applaudissements", False),
    "Confetti burst": ("Explosion de confettis", True), "Firework": ("Feu d'artifice", False), "Party popper": ("Cotillon qui éclate", False),
    "Alarm clock": ("Réveil", False), "Clock ticking": ("Tic-tac d'horloge", False), "Fast ticking": ("Tic-tac rapide", False),
    "3-2-1 countdown": ("Compte à rebours 3-2-1", False), "Stopwatch": ("Chronomètre", False), "Timer done": ("Minuteur terminé", False),
    "Card payment tap": ("Paiement sans contact", False), "Coin drop": ("Pièce qui tombe", True), "Coin spinning": ("Pièce qui tourne", True),
    "Coins stacking": ("Pièces qu'on empile", True), "Coins pouring": ("Pièces qui se déversent", True), "Counting notes": ("Billets qu'on compte", False),
    "Cash register": ("Caisse enregistreuse", True), "Blip": ("Blip", False), "Security breach": ("Faille de sécurité", True),
    "Data corrupting": ("Données qui se corrompent", True), "Decrypted": ("Déchiffré", False), "Access denied": ("Accès refusé", False),
    "Glitch": ("Glitch", False), "Hacker chatter": ("Activité de hacker", True), "Interference": ("Interférences", True),
    "Power down": ("Extinction", True), "Power up": ("Allumage", False), "Process": ("Traitement", False), "Radio tuning": ("Recherche de station radio", True),
    "Scan": ("Scan", False), "Scramble": ("Brouillage", False), "Signal drop": ("Perte de signal", True), "TV static": ("Neige de télé", True),
    "Bar growing": ("Barre qui grandit", True), "Chart reveal": ("Graphique qui apparaît", False), "Count-up": ("Compteur qui monte", False),
    "Count-down": ("Compteur qui descend", False), "Number landing": ("Chiffre qui se pose", False), "Progress fill": ("Barre de progression", True),
    "Count tick": ("Tic de compteur", False),
}

# Qualificatifs (après la virgule) → (masculin, féminin)
WORDS = {
    "fast": ("rapide", "rapide"), "medium": ("moyen", "moyenne"), "slow": ("lent", "lente"), "hard": ("fort", "forte"),
    "soft": ("doux", "douce"), "firm": ("ferme", "ferme"), "strong": ("fort", "forte"), "long": ("long", "longue"),
    "short": ("court", "courte"), "deep": ("sourd", "sourde"), "heavy": ("lourd", "lourde"), "light": ("léger", "légère"),
    "big": ("gros", "grosse"), "massive": ("énorme", "énorme"), "large": ("grand", "grande"), "small": ("petit", "petite"),
    "quick": ("rapide", "rapide"), "steady": ("régulier", "régulière"), "clear": ("net", "nette"), "subtle": ("discret", "discrète"),
    "bright": ("brillant", "brillante"), "sparkle": ("scintillant", "scintillante"), "airy": ("aérien", "aérienne"),
    "bold": ("affirmé", "affirmée"), "minimal": ("minimaliste", "minimaliste"), "playful": ("ludique", "ludique"),
    "tech": ("tech", "tech"), "warm": ("chaleureux", "chaleureuse"), "bubble": ("bulle", "bulle"), "chime": ("carillon", "carillon"),
    "ding-ding": ("ding-ding", "ding-ding"), "fanfare": ("fanfare", "fanfare"), "flourish": ("envolée", "envolée"),
    "pluck": ("pincé", "pincée"), "deflate": ("dégonflé", "dégonflée"), "fall": ("chute", "chute"), "knock": ("toc", "toc"),
    "low": ("grave", "grave"), "minor": ("mineur", "mineure"), "thud": ("bruit sourd", "bruit sourd"), "wobble": ("vacillant", "vacillante"),
    "high": ("aigu", "aiguë"), "middle": ("médium", "médium"), "on a firm surface": ("sur une surface ferme", "sur une surface ferme"),
    "on a hard surface": ("sur une surface dure", "sur une surface dure"), "on a soft surface": ("sur une surface molle", "sur une surface molle"),
    "a crowd": ("d'une foule", "d'une foule"), "a few people": ("de quelques personnes", "de quelques personnes"),
}

YOUTUBE = {"whooshes", "swishes-and-zips", "reverse-whooshes", "risers-and-fallers", "cinematic-hits", "booms-and-bass",
           "logo-stings", "pops", "shimmers", "appear-and-vanish", "digital", "bounce-spin-zoom", "notifications"}


def title_fr(name: str) -> str:
    head, _, rest = name.partition(", ")
    fr, fem = HEADS[head]
    parts = []
    for p in [x for x in re.split(r", | and ", rest) if x]:
        if re.fullmatch(r"\d+ s", p):
            parts.append(p)
        else:
            parts.append(WORDS[p][1 if fem else 0])
    if " and " in rest and len(parts) == 2:  # « Whoosh, slow and hard » → « Whoosh lent et fort »
        return f"{fr} {parts[0]} et {parts[1]}"
    return " ".join([fr, *parts]) if parts else fr


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--kit", type=Path, required=True, help="dossier du dépôt sfx-kit cloné")
    ap.add_argument("--sortie", type=Path, required=True)
    ap.add_argument("--reference", type=Path, action="append", default=[])
    args = ap.parse_args()
    kit = json.loads((args.kit / "sounds.json").read_text(encoding="utf-8"))
    files = args.sortie / "sons"
    files.mkdir(parents=True, exist_ok=True)

    similar, hashes = Doublons(), set()
    for ref in args.reference:
        doc = json.loads(ref.read_text(encoding="utf-8"))
        for s in (doc["sounds"] if isinstance(doc, dict) else doc):
            similar.add(s.get("durationMs", 0), s.get("peaks") or [])
            if s.get("sha1"):
                hashes.add(s["sha1"])

    catalog, skipped = [], 0
    for s in kit["sounds"]:
        src = args.kit / s["file"]
        code, ucs, cat = CATS[s["category"]]
        sid = f"wyz-{s['id']}"
        dest = files / f"{code}_{s['id']}_wyz.wav"
        shutil.copyfile(src, dest)
        dur = int(probe(dest) * 1000)
        peaks, sha1 = peaks_of(dest), pcm_hash(dest)
        if sha1 in hashes or similar.known(dur, peaks):
            skipped += 1
            dest.unlink()
            print(f"  doublon écarté : {s['name']}")
            continue
        hashes.add(sha1); similar.add(dur, peaks)
        en_tags = [t for t in s.get("tags", []) if 1 < len(t) < 25]
        # « step » (étape) n'est pas « pas », « drop » (chute) pas « goutte » : traductions ambiguës écartées
        fr_tags = sorted({FR[w] for t in en_tags for w in re.findall(r"[a-z]+", t) if w in FR and w not in {"step", "drop", "drops"}})
        extra = ["youtube", "montage", "vidéo"] if s["category"] in YOUTUBE else ["vidéo"]
        use = "; ".join(s.get("use_for", [])[:3])
        catalog.append({
            "id": sid, "title": title_fr(s["name"]), "titleEn": s["name"],
            "description": s["description"] + (f" Use for: {use}." if use else ""),
            "descriptionEn": s["description"] + (f" Use for: {use}." if use else ""),
            "code": code, "ucs": ucs, "category": cat,
            "tags": list(dict.fromkeys(fr_tags + en_tags + extra))[:14],
            "durationMs": dur, "file": dest.name,
            "format": f"WAV · 48 kHz · 24 bits · {'mono' if channels(dest) == 1 else 'stéréo'}",
            "license": "CC0", "author": "Wyzowl", "credit": "SFX Kit - Wyzowl", "source": "SFX Kit",
            "sourceUrl": SOURCE_URL, "peaks": peaks, "sha1": sha1, "bytes": dest.stat().st_size, "pack": "SFX Kit",
        })
    (args.sortie / "catalog.json").write_text(json.dumps(catalog, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(catalog)} sons gardés, {skipped} doublons écartés, {sum(x['bytes'] for x in catalog)/1e6:.0f} Mo")
    return 0


if __name__ == "__main__":
    sys.exit(main())
