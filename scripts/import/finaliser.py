#!/usr/bin/env python3
"""Finition d'un import avant publication (OpenGameArt, NPS, Kenney…).

- Catégorie déduite du nom du son lui-même (et seulement à défaut du pack), alignée sur les
  catégories déjà présentes dans la bibliothèque (codes UCS de BigSoundBank).
- Titre nettoyé (« Sounds powerup2 » → « Powerup 2 »), en anglais : la recherche d'Onde
  trouve aussi ces sons en français grâce aux mots-clés traduits ajoutés.
- Crédit affiché dans l'app : « Source - Auteur ».

Usage :
  python3 scripts/import/finaliser.py --bibliotheque DOSSIER [--source OpenGameArt]
"""
from __future__ import annotations

import argparse
import collections
import json
import re
import sys
from pathlib import Path

# (motif sur les mots anglais, code, catégorie) — du plus précis au plus général
RULES = [
    (r"\b(8 ?bit|chiptune|retro|arcade|power ?up|pickup|coin|jump|level ?up|game ?over|blip|casino|dice|chips?|cards?)\b", "GAME", "Jeux"),
    (r"\b(whoosh|swoosh|swish|woosh|swing|swipe)\b", "SWSH", "Whooshes"),
    (r"\b(laser|zap|phaser|blaster)\b", "LASR", "Lasers"),
    (r"\b(gun|gunshot|rifle|pistol|reload|bullet|shotgun|shot)\b", "GUN", "Armes à feu"),
    (r"\b(explosion|explode|blast|bomb|boom|exp)\b", "EXPL", "Explosions"),
    (r"\b(sword|blade|knife|dagger|axe|arrow|bow|quiver|sheathe?|seax|spear|shield|weapon)\b", "WEAP", "Armes blanches"),
    (r"\b(punch|kick|slap|fight|hurt)\b", "FGHT", "Combat"),
    (r"\b(door|gate|hinge|creak|latch|lock|keys?)\b", "DOOR", "Portes"),
    (r"\b(footsteps?|steps?|walk|walking|run|running)\b", "FEET", "Pas"),
    (r"\b(robot|servo|droid)\b", "ROBT", "Robots"),
    (r"\b(sci ?fi|scifi|space|teleport|alien|spaceship|futuristic)\b", "SCI", "Science-fiction"),
    (r"\b(magic|spell|enchant|mana|heal|potion|sparkle|shade)\b", "MAGC", "Magie"),
    (r"\b(monster|creature|creture|growl|roar|zombie|ghost|demon|beast|snarl)\b", "CREA", "Créatures"),
    (r"\b(birds?|robin|eagle|owl|raven|crow|sparrow|warbler|flycatcher|gull|petrel|goose|geese|duck|chickens?|anhinga|nutcracker|poorwill|loon|woodpecker|thrush|wren|jay|hawk|heron|ua.u|condor|vireo|kingfisher|bunting|grouse|quail|lark|tern|cardinal|osprey|turkey|ptarmigan)\b", "BIRD", "Oiseaux"),
    (r"\b(dog|cat|horse|cow|pig|wolf|wolves|bears?|frog|bison|elk|sheep|ram|alligator|insect|bee|coyote|cricket|toad|whale|seal|sea lion|moose|squirrel|pika|marmot|bat)\b", "ANML", "Animaux"),
    (r"\b(scream|laugh|yell|shout|grunt|death|die|voice|speech|talk)\b", "VOX", "Voix"),
    (r"\b(breath|breathing|cough|gasp|sigh|heartbeat|finger|clap|snap)\b", "HMN", "Humain"),
    (r"\b(ui|click|clicks|button|menu|interface|select|confirm|notification|toggle|switch|tap|hover|error|clickety)\b", "UI", "Interface"),
    (r"\b(beep|bleep|beeps)\b", "BEEP", "Bips"),
    (r"\b(bells?|chime|ding)\b", "BELL", "Cloches"),
    (r"\b(music|jingle|melody|loop|guitar|piano|drum|fanfare|victory|song|harp|flute)\b", "MUSC", "Musique et instruments"),
    (r"\b(glass|bottle|vial|jar|cork|uncork)\b", "GLAS", "Verre"),
    (r"\b(chains?)\b", "CHAIN", "Chaînes"),
    (r"\b(metal|metallic|iron|steel|clang|anvil|tin)\b", "METL", "Métal"),
    (r"\b(wood|wooden|plank|log|stick)\b", "WOOD", "Bois"),
    (r"\b(paper|page|book|stationery|pencil|pen|envelope)\b", "PAPR", "Papier"),
    (r"\b(plastic)\b", "PLAS", "Plastique"),
    (r"\b(mud|slime|goo|squish|squelch)\b", "LIQ", "Liquides et boue"),
    (r"\b(water|splash|drip|drop|bubble|bubbles|underwater|river|waves?|pour|liquid|waterfall|geyser|stream)\b", "WATR", "Eau"),
    (r"\b(rain)\b", "RAIN", "Pluie"),
    (r"\b(thunder|storm)\b", "STORM", "Orage"),
    (r"\b(wind|breeze)\b", "WIND", "Vent"),
    (r"\b(fire|flame|burn|fireball|torch|campfire)\b", "FIRE", "Feu"),
    (r"\b(cannon|battle|musket|war)\b", "GUN", "Armes à feu"),
    (r"\b(electric|spark|buzz|static|zap|power ?down)\b", "ELEC", "Électricité"),
    (r"\b(engine|motor|car alarm|car|truck|vehicle)\b", "VEH", "Véhicules"),
    (r"\b(alarm|siren|warning)\b", "ALRM", "Alarmes"),
    (r"\b(hammer|saw|chainsaw|drill|craft|tool|chop|crafting)\b", "TOOL", "Outils"),
    (r"\b(machine|mechanical|gear|crank|lever)\b", "MACH", "Machines"),
    (r"\b(clock|tick|tock)\b", "CLOCK", "Horloges"),
    (r"\b(rock|stone|rubble|debris|boulder)\b", "ROCK", "Rochers"),
    (r"\b(dirt|sand|gravel|dig|digging)\b", "DIRT", "Terre et sable"),
    (r"\b(cloth|fabric|leather|armor|armour|apparel|zipper|bag|backpack)\b", "CLOTH", "Tissus"),
    (r"\b(eat|eating|chew|drink|drinking|bite|crunch|food|munch|gulp)\b", "FOOD", "Nourriture et boissons"),
    (r"\b(cartoon|boing|wobble|pop|squeak|weird|funny)\b", "TOON", "Cartoon"),
    (r"\b(money|coins?|purse|wallet)\b", "OBJ", "Objets"),
    (r"\b(scrape|scraping|slide|sliding|drag|movement|move)\b", "MOVE", "Mouvement"),
    (r"\b(hit|impact|thud|knock|bump|smack|crash|slam|break|breaking|falling|fall)\b", "IMPC", "Impacts"),
    (r"\b(ambience|ambient|atmosphere|room tone|forest|city|crowd|nature)\b", "AMB", "Ambiances"),
]

# Traductions ajoutées aux mots-clés, pour que la recherche en français trouve ces sons.
FR = {
    "door": "porte", "gate": "portail", "lock": "serrure", "key": "clé", "keys": "clés", "creak": "grincement", "hinge": "gond",
    "footstep": "pas", "footsteps": "pas", "step": "pas", "walk": "marche", "run": "course",
    "explosion": "explosion", "boom": "boum", "blast": "explosion", "gun": "arme", "shot": "tir", "gunshot": "coup de feu", "reload": "recharger",
    "sword": "épée", "blade": "lame", "knife": "couteau", "dagger": "dague", "axe": "hache", "arrow": "flèche", "bow": "arc", "shield": "bouclier",
    "punch": "coup de poing", "kick": "coup de pied", "slap": "gifle", "hit": "coup", "impact": "impact", "crash": "fracas", "knock": "frapper", "thud": "choc",
    "break": "casser", "breaking": "casse", "fall": "chute", "falling": "chute",
    "whoosh": "whoosh", "swoosh": "whoosh", "swing": "balancement", "laser": "laser",
    "monster": "monstre", "creature": "créature", "growl": "grognement", "roar": "rugissement", "zombie": "zombie", "ghost": "fantôme", "alien": "extraterrestre",
    "bird": "oiseau", "birds": "oiseaux", "eagle": "aigle", "owl": "hibou", "raven": "corbeau", "crow": "corbeau", "goose": "oie", "geese": "oies", "duck": "canard", "chicken": "poule", "chickens": "poules",
    "dog": "chien", "cat": "chat", "horse": "cheval", "cow": "vache", "pig": "cochon", "wolf": "loup", "bear": "ours", "frog": "grenouille", "bee": "abeille", "insect": "insecte", "alligator": "alligator", "sheep": "mouton", "bison": "bison", "coyote": "coyote",
    "scream": "cri", "laugh": "rire", "yell": "hurlement", "shout": "cri", "grunt": "grognement", "voice": "voix", "breath": "respiration", "cough": "toux", "heartbeat": "battement de cœur",
    "click": "clic", "button": "bouton", "menu": "menu", "interface": "interface", "select": "sélection", "confirm": "validation", "notification": "notification", "error": "erreur", "switch": "interrupteur",
    "beep": "bip", "bell": "cloche", "chime": "carillon", "ding": "ding",
    "music": "musique", "jingle": "jingle", "melody": "mélodie", "loop": "boucle", "guitar": "guitare", "piano": "piano", "drum": "tambour", "victory": "victoire",
    "glass": "verre", "bottle": "bouteille", "jar": "bocal", "cork": "bouchon", "uncork": "déboucher",
    "metal": "métal", "iron": "fer", "steel": "acier", "chain": "chaîne", "chains": "chaînes",
    "wood": "bois", "wooden": "bois", "paper": "papier", "page": "page", "book": "livre", "pencil": "crayon", "pen": "stylo", "plastic": "plastique",
    "water": "eau", "splash": "éclaboussure", "drip": "goutte", "drop": "goutte", "bubble": "bulle", "bubbles": "bulles", "underwater": "sous l'eau", "river": "rivière", "wave": "vague", "waves": "vagues", "pour": "verser", "waterfall": "cascade",
    "mud": "boue", "slime": "slime", "rain": "pluie", "thunder": "tonnerre", "storm": "orage", "wind": "vent",
    "fire": "feu", "flame": "flamme", "burn": "brûler", "torch": "torche", "cannon": "canon", "battle": "bataille",
    "electric": "électrique", "spark": "étincelle", "buzz": "bourdonnement", "engine": "moteur", "motor": "moteur", "car": "voiture", "truck": "camion", "alarm": "alarme", "siren": "sirène",
    "hammer": "marteau", "saw": "scie", "chainsaw": "tronçonneuse", "drill": "perceuse", "tool": "outil", "machine": "machine", "gear": "engrenage", "lever": "levier",
    "clock": "horloge", "tick": "tic-tac", "rock": "rocher", "stone": "pierre", "debris": "débris", "dirt": "terre", "sand": "sable", "gravel": "gravier", "dig": "creuser",
    "cloth": "tissu", "fabric": "tissu", "leather": "cuir", "armor": "armure", "zipper": "fermeture éclair", "bag": "sac",
    "eat": "manger", "chew": "mâcher", "drink": "boire", "bite": "croquer", "crunch": "croquant", "food": "nourriture",
    "cartoon": "cartoon", "pop": "pop", "squeak": "couinement", "weird": "bizarre", "money": "argent", "coin": "pièce", "coins": "pièces",
    "scrape": "raclement", "slide": "glissement", "magic": "magie", "spell": "sort", "heal": "soin", "potion": "potion",
    "jump": "saut", "powerup": "bonus", "pickup": "ramassage", "card": "carte", "cards": "cartes", "dice": "dés", "casino": "casino",
    "space": "espace", "robot": "robot", "teleport": "téléportation", "forest": "forêt", "city": "ville", "crowd": "foule", "nature": "nature",
}
JUNK = re.compile(r"\b(sfx\d*\w*|sounds?|effects?|wav|ogg|mp3|final|edit|v\d+|exp|cc0)\b", re.I)


def words(s: str) -> str:
    s = re.sub(r"(?<=[a-z])(?=[A-Z])", " ", s)
    s = re.sub(r"(?<=[A-Za-z])(?=\d)|(?<=\d)(?=[A-Za-z])", " ", s)
    return re.sub(r"[_\-.()\[\]/]+", " ", s).lower()


def categorize(primary: str, fallback: str) -> tuple[str, str]:
    for text in (primary, fallback):
        for pattern, code, cat in RULES:
            if re.search(pattern, text):
                return code, cat
    return "MISC", "Divers"


def clean_title(title: str) -> str:
    toks = JUNK.sub(" ", words(title)).split()
    # on garde les mots ; parmi les nombres, seulement le dernier (le numéro du son)
    keep = [t for i, t in enumerate(toks) if re.fullmatch(r"[a-z][a-z']+", t) or (t.isdigit() and i == len(toks) - 1)]
    if not any(re.fullmatch(r"[a-z']{3,}", t) for t in keep):
        return title
    t = " ".join(keep)
    return t[:1].upper() + t[1:]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--bibliotheque", type=Path, required=True)
    args = ap.parse_args()
    path = args.bibliotheque / "catalog.json"
    cat = json.loads(path.read_text(encoding="utf-8"))
    count: collections.Counter = collections.Counter()
    for s in cat:
        stem = Path(s.get("originalFile") or s["file"]).stem
        own = words(f"{s['title']} {stem}")
        pack = words(f"{s.get('pack', '')} {' '.join(s.get('tags', []))}")
        s["code"], s["category"] = categorize(own, pack)
        title = clean_title(s["title"]) if s.get("source") != "NPS" else s["title"]
        s["title"] = title
        s["titleEn"] = title
        en = sorted({w for w in re.findall(r"[a-z]{3,}", own) if w not in {"sfx", "the", "and", "with", "sound", "sounds"}})
        fr = sorted({FR[w] for w in re.findall(r"[a-z]+", own) if w in FR})
        orig = [t for t in s.get("tags", []) if re.fullmatch(r"[a-zà-ÿ][a-zà-ÿ ' -]{2,20}", t) and t not in {"wav", "ogg", "sfx", "fbx", "cc0", "lo-fi"}]
        s["tags"] = list(dict.fromkeys(fr + en + orig))[:12]
        src, author = s.get("source", ""), s.get("author", "")
        s["credit"] = s.get("credit") or (f"{src} - {author}" if author else src)
        count[s["category"]] += 1
    path.write_text(json.dumps(cat, ensure_ascii=False, indent=1), encoding="utf-8")
    print(f"{len(cat)} sons finalisés")
    for c, k in count.most_common():
        print(f"  {k:5d}  {c}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
