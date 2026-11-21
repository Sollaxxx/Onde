// Langue de l'interface : français ou anglais.
// Les textes restent écrits en français dans le code : t("Réglages") renvoie « Settings » en anglais.
// Une phrase ajoutée sans traduction s'affiche en français (et `node scripts/verifier-traductions.mjs` la signale).
import type { Sound } from "./types";

export type Lang = "fr" | "en";
export type LangPref = "auto" | Lang;

const KEY = "onde.langue";

function systemLang(): Lang {
  try {
    const l = (navigator.languages?.[0] ?? navigator.language ?? "fr").toLowerCase();
    return l.startsWith("fr") ? "fr" : "en";
  } catch {
    return "fr";
  }
}

function readPref(): LangPref {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? '"auto"');
    return v === "fr" || v === "en" ? v : "auto";
  } catch {
    return "auto";
  }
}

let pref: LangPref = readPref();
let lang: Lang = pref === "auto" ? systemLang() : pref;

export const getLang = (): Lang => lang;
export const langPref = (): LangPref => pref;

/** Change la langue (« auto » : celle du système). `save` : la retenir pour les prochains lancements. */
export function setLangPref(p: LangPref, save = true): void {
  pref = p;
  lang = p === "auto" ? systemLang() : p;
  if (save) try { localStorage.setItem(KEY, JSON.stringify(p)); } catch { /* stockage indisponible */ }
}

/** Traduit un texte et remplace ses {variables}. */
export function t(fr: string, vars?: Record<string, string | number>): string {
  const s = lang === "en" ? (EN[fr] ?? fr) : fr;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

/** Singulier ou pluriel selon `n` (en français 0 et 1 sont au singulier, en anglais seul 1 l'est). */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  const plural = lang === "en" ? n !== 1 : n > 1;
  return t(plural ? many : one, { n, ...vars });
}

/** Comparaison alphabétique dans la langue de l'interface. */
export function collate(a: string, b: string): number {
  return a.localeCompare(b, lang);
}

/** Message d'une erreur (souvent venue de Rust, en français), traduit si on le connaît. */
export function errText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  if (lang === "fr") return msg;
  if (EN[msg]) return EN[msg];
  for (const [re, en] of ERR_PATTERNS) if (re.test(msg)) return msg.replace(re, en);
  return msg;
}

// ---------- Sons : titre, description, catégorie… dans la langue de l'interface ----------
export const soundTitle = (s: Sound): string => (lang === "en" && s.titleEn ? s.titleEn : s.title);
export const soundDesc = (s: Sound): string => (lang === "en" ? s.descriptionEn || s.description || "" : s.description || "");
export const catLabel = (c: string): string => (lang === "en" ? CATS[c] ?? c : c);
export const licenseLabel = (l: string): string => (lang === "en" ? ({ "Domaine public": "Public domain", "Votre son": "Your sound", "Son de l'équipe": "Team sound" } as Record<string, string>)[l] ?? l : l);
/** « WAV · 48 kHz · 24 bits · stéréo » → « WAV · 48 kHz · 24-bit · stereo » */
export const formatLabel = (f: string): string =>
  lang === "en" ? f.replace(/(\d+) bits/, "$1-bit").replace("stéréo", "stereo").replace("multicanal", "multichannel") : f;

/** Les 81 catégories de la banque (noms français du catalogue → anglais, d'après UCS). */
const CATS: Record<string, string> = {
  "Mes sons": "My sounds",
  "Ailes": "Wings", "Air": "Air", "Alarmes": "Alarms", "Ambiances": "Ambience", "Animaux": "Animals",
  "Armes blanches": "Bladed weapons", "Armes à feu": "Guns", "Avions": "Aircraft", "Balles": "Bullets", "Bateaux": "Boats",
  "Bips": "Beeps", "Bois": "Wood", "Caoutchouc": "Rubber", "Cartoon": "Cartoon", "Chaînes": "Chains", "Cloches": "Bells",
  "Combat": "Fighting", "Communications": "Communications", "Cordes": "Rope", "Créatures": "Creatures", "Céramique": "Ceramics",
  "Design sonore": "Sound design", "Divers": "Miscellaneous", "Eau": "Water", "Explosions": "Explosions", "Fenêtres": "Windows",
  "Feu": "Fire", "Feux d'artifice": "Fireworks", "Foley": "Foley", "Foules": "Crowds", "Glace": "Ice", "Gore": "Gore",
  "Horloges": "Clocks", "Humain": "Human", "Impacts": "Impacts", "Interface": "User interface", "Jeux": "Games", "Jouets": "Toys",
  "Klaxons": "Horns", "Lasers": "Lasers", "Liquides et boue": "Liquid & mud", "Machines": "Machines", "Magie": "Magic",
  "Moteurs": "Motors", "Mouvement": "Movement", "Musique et instruments": "Music & instruments", "Mécanique": "Mechanical",
  "Métal": "Metal", "Nourriture et boissons": "Food & drink", "Objets": "Objects", "Oiseaux": "Birds", "Orage": "Thunder",
  "Ordinateurs": "Computers", "Outils": "Tools", "Papier": "Paper", "Pas": "Footsteps", "Pets": "Farts", "Plastique": "Plastic",
  "Pluie": "Rain", "Portes": "Doors", "Pump": "Pumps", "Robots": "Robots", "Rochers": "Rocks", "Science-fiction": "Sci-fi",
  "Sifflets": "Whistles", "Sports": "Sports", "Storm": "Storm", "Terre et sable": "Dirt & sand", "Test": "Test tones", "Thun": "Thunder",
  "Tiroirs": "Drawers", "Tissus": "Cloth", "Trains": "Trains", "Vent": "Wind", "Verre": "Glass", "Voix": "Voices",
  "Végétation": "Vegetation", "Véhicules": "Vehicles", "Whooshes": "Whooshes", "Électricité": "Electricity", "Équipement": "Equipment",
};

/** Erreurs de Rust avec une partie variable : « dossier inaccessible : … ». */
const ERR_PATTERNS: [RegExp, string][] = [
  [/^dossier inaccessible : /, "folder not accessible: "],
  [/^fichier illisible : /, "unreadable file: "],
  [/^copie impossible : /, "copy failed: "],
  [/^Copie impossible /, "Copy failed "],
  [/^Téléchargement impossible : /, "Download failed: "],
  [/^Son inconnu : /, "Unknown sound: "],
  [/^Catalogue introuvable /, "Catalogue not found "],
  [/^ancien panneau impossible à remplacer \((.*)\)\. Fermez (.*) et réessayez\.$/, "the old panel could not be replaced ($1). Close $2 and try again."],
  [/^dossier des plugins Resolve inaccessible : /, "Resolve plugin folder not accessible: "],
];

const EN: Record<string, string> = {
  // Barre de titre, fenêtre
  "BÊTA": "BETA",
  "Intégrations": "Integrations",
  "Passer en mode clair": "Switch to light mode",
  "Passer en mode sombre": "Switch to dark mode",
  "Mode clair": "Light mode",
  "Mode sombre": "Dark mode",
  "Revenir à la grande fenêtre": "Back to the large window",
  "Petite fenêtre toujours au premier plan": "Small window, always on top",
  "Grande fenêtre": "Large window",
  "Mode compact": "Compact mode",
  "Envoyer un retour": "Send feedback",
  "Réglages": "Settings",
  "Réduire": "Minimize",
  "Agrandir": "Maximize",
  "Fermer": "Close",

  // Barre de gauche
  "Bibliothèque": "Library",
  "Mes sons": "My sounds",
  "Récents": "Recent",
  "Mes contributions": "My contributions",
  "Navigation": "Navigation",
  "Catégories UCS": "UCS categories",
  "Favoris": "Favorites",
  "Titres likés": "Liked sounds",
  "Nouvelle playlist": "New playlist",
  "en ligne": "online",
  "hors ligne": "offline",
  "sons de test": "test sounds",
  "{n} son": "{n} sound",
  "{n} sons": "{n} sounds",
  "{n} à vous": "{n} of yours",
  "Dossier local": "Local folder",
  "Ouvrir le dossier": "Open folder",
  "Biblio n°{k}": "Library #{k}",

  // Liste des sons
  "Nom de la playlist": "Playlist name",
  "Supprimer « {name} » ? Les sons ne sont pas effacés.": "Delete “{name}”? The sounds themselves are not deleted.",
  "Annuler": "Cancel",
  "Supprimer": "Delete",
  "Supprimer la playlist": "Delete playlist",
  "Rechercher un son": "Search for a sound",
  "Décrivez un son : « porte qui grince », « whoosh »…": "Describe a sound: “creaking door”, “whoosh”…",
  "Hors ligne": "Offline",
  "{n} son disponible sur cet ordinateur": "{n} sound available on this computer",
  "{n} sons disponibles sur cet ordinateur": "{n} sounds available on this computer",
  "Afficher toute la bibliothèque": "Show the whole library",
  "Seulement les sons disponibles": "Only available sounds",
  "Catégorie": "Category",
  "Toutes les catégories": "All categories",
  "Effacer le filtre": "Clear filter",
  "{n} SON": "{n} SOUND",
  "{n} SONS": "{n} SOUNDS",
  "Résultats": "Results",
  "Afficher plus ({n} autres sons)": "Show more ({n} more sounds)",
  "Hors ligne, et aucun son n'est encore sur cet ordinateur. Les sons que vous écoutez en ligne restent ensuite disponibles hors ligne.": "You're offline, and no sounds are on this computer yet. Sounds you play while online stay available offline afterwards.",
  "Aucun son disponible hors ligne dans cette sélection.": "No sounds available offline in this selection.",
  "Aucun titre liké pour l'instant. Touchez l'étoile d'un son, ou la touche F.": "No liked sounds yet. Click a sound's star, or press F.",
  "Ajoutez vos propres dossiers de sons dans Réglages → Mes sons : ils apparaîtront ici et dans la recherche, à côté de la banque.": "Add your own sound folders in Settings → My sounds: they'll show up here and in search, next to the library.",
  "Lecture de vos dossiers…": "Reading your folders…",
  "Playlist vide. Sélectionnez un son, puis « Ajouter à une playlist » dans le panneau de droite.": "Empty playlist. Select a sound, then “Add to a playlist” in the right panel.",
  "Les sons que vous écoutez apparaîtront ici.": "Sounds you play will show up here.",
  "Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».": "No matching sounds. Try “door”, “impact” or “rain”.",
  "Hors ligne : ce son n'est pas encore sur cet ordinateur": "Offline: this sound isn't on this computer yet",
  "Hors ligne : ce son n'est pas encore sur cet ordinateur.": "Offline: this sound isn't on this computer yet.",
  "Glissez vers votre timeline": "Drag to your timeline",
  "Pause": "Pause",
  "Écouter": "Play",
  "Retirer des titres likés": "Remove from liked sounds",
  "Ajouter aux titres likés": "Add to liked sounds",

  // Panneau de droite
  "Sélectionnez un son.": "Select a sound.",
  "Son sélectionné": "Selected sound",
  "Glissez la forme d'onde vers votre timeline": "Drag the waveform to your timeline",
  "Ajouter à une playlist": "Add to a playlist",
  "Nouvelle playlist avec ce son": "New playlist with this sound",
  "Format": "Format",
  "Licence": "License",
  "CC0 · sans crédit obligatoire": "CC0 · no credit required",
  "Fichier": "File",
  "Code UCS": "UCS code",
  "Son :": "Sound:",
  "Ouvrir la page du son": "Open the sound's page",
  "Glissez-moi dans votre timeline": "Drag me into your timeline",
  "Afficher dans le dossier": "Show in folder",
  "Astuce : vous pouvez aussi attraper n'importe quelle ligne de la liste.": "Tip: you can also grab any row in the list.",
  "Glissez dans la timeline": "Drag to the timeline",

  // Intégrations
  "Installation…": "Installing…",
  "BIENTÔT": "SOON",
  "INSTALLÉ": "INSTALLED",
  "STUDIO REQUIS": "STUDIO REQUIRED",
  "Mettre à jour": "Update",
  "Installer": "Install",
  "Panneau Onde dans Premiere · 2019 et plus": "Onde panel inside Premiere · 2019 and later",
  "Panneau Onde dans Resolve · Studio 18 et plus": "Onde panel inside Resolve · Studio 18 and later",
  "Panneau Onde": "Onde panel",
  "Avec la version macOS": "With the macOS version",
  "Tous les logiciels": "Every editing app",
  "Glissez un son depuis Onde vers votre timeline": "Drag a sound from Onde to your timeline",
  "ACTIF": "ON",
  "Intégrations logicielles": "App integrations",
  "Utilisez Onde directement dans votre logiciel de montage.": "Use Onde right inside your editing app.",
  "Panneau installé. Redémarrez Premiere Pro, puis Fenêtre → Extensions → Onde.": "Panel installed. Restart Premiere Pro, then Window → Extensions → Onde.",
  "Panneau installé. Redémarrez DaVinci Resolve, puis Espace de travail → Intégrations de workflow → Onde.": "Panel installed. Restart DaVinci Resolve, then Workspace → Workflow Integrations → Onde.",
  "Installation impossible : {e}": "Installation failed: {e}",

  // Mise à jour
  "MISE À JOUR": "UPDATE",
  "Onde {v} est prête.": "Onde {v} is ready.",
  "Plus tard": "Later",
  "Installer et redémarrer": "Install and restart",
  "Mise à jour installée": "Update installed",
  "Nouveautés d'Onde {v}": "What's new in Onde {v}",
  "C'est parti": "Let's go",

  // Retour
  "Un bug": "A bug",
  "Une idée": "An idea",
  "Autre chose": "Something else",
  "Ce que vous faisiez, ce qui s'est passé, ce que vous attendiez…": "What you were doing, what happened, what you expected…",
  "Ce qui vous ferait gagner du temps au montage…": "What would save you time while editing…",
  "Votre message…": "Your message…",
  "Onde est en bêta : chaque message est lu, et c'est comme ça qu'il s'améliore.": "Onde is in beta: every message gets read, and that's how it gets better.",
  "Type de retour": "Feedback type",
  "Message": "Message",
  "Votre e-mail": "Your email",
  "facultatif, pour qu'on puisse vous répondre": "optional, so we can reply",
  "vous@exemple.fr": "you@example.com",
  "La version d'Onde ({v}) et le système sont ajoutés automatiquement. Rien d'autre n'est envoyé.": "Your Onde version ({v}) and operating system are added automatically. Nothing else is sent.",
  "Écrire par e-mail à la place": "Send an email instead",
  "Envoi…": "Sending…",
  "Envoyer": "Send",
  "Écrivez-nous à {mail}": "Write to us at {mail}",
  "Retour sur Onde": "Feedback about Onde",
  "Écrivez quelques mots avant d'envoyer.": "Write a few words before sending.",
  "Merci ! Votre retour est bien arrivé.": "Thanks! Your feedback has arrived.",

  // Réglages
  "Apparence": "Appearance",
  "Dossier des sons": "Sound folder",
  "Raccourcis": "Shortcuts",
  "Mises à jour": "Updates",
  "À propos": "About",
  "Clair": "Light",
  "Sombre": "Dark",
  "Comme macOS": "Like macOS",
  "Comme Windows": "Like Windows",
  "Rechercher": "Search",
  "Écouter / pause": "Play / pause",
  "ESPACE": "SPACE",
  "Son suivant / précédent": "Next / previous sound",
  "Ajouter aux favoris": "Add to favorites",
  "Fermer / revenir": "Close / go back",
  "ÉCHAP": "ESC",
  "Glisser vers la timeline": "Drag to the timeline",
  "SOURIS": "MOUSE",
  "Sections des réglages": "Settings sections",
  "Langue": "Language",
  "La langue de l'interface. Les sons gardent leur nom dans les deux langues pour la recherche.": "The interface language. You can search sounds in either language.",
  "Mode": "Mode",
  "Le mode sombre est plus doux en salle de montage.": "Dark mode is easier on the eyes in the edit suite.",
  "Mode d'affichage": "Display mode",
  "Animation au démarrage": "Launch animation",
  "L'animation du logo à chaque ouverture d'Onde.": "The logo animation every time Onde opens.",
  "Avec le son": "With sound",
  "Sans le son": "Without sound",
  "Désactivée": "Off",
  "Emplacement": "Location",
  "Ouvrir": "Open",
  "Changer…": "Change…",
  "Ajoutez vos propres dossiers de sons : ils apparaissent dans « Mes sons », dans la recherche et dans vos playlists, à côté de la banque. Les fichiers restent où ils sont : Onde ne les copie, ne les déplace et ne les efface jamais.": "Add your own sound folders: they show up in “My sounds”, in search and in your playlists, next to the library. Files stay where they are: Onde never copies, moves or deletes them.",
  "Retirer": "Remove",
  "Actualiser": "Refresh",
  "Ajouter un dossier…": "Add a folder…",
  "Revenir au dossier par défaut": "Back to the default folder",
  "Documents\\Onde. Les sons déjà utilisés restent à leur place : vos projets de montage les retrouvent toujours.": "Documents\\Onde. Sounds you've already used stay where they are: your editing projects always find them.",
  "Rétablir": "Reset",
  "Nettoyage automatique": "Automatic cleanup",
  "Les sons seulement écoutés sont effacés s'ils ne servent plus. Ceux que vous avez glissés dans un logiciel de montage ne sont jamais effacés.": "Sounds you only listened to are deleted when they're no longer played. Sounds you dragged into an editing app are never deleted.",
  "{n} son conservé.": "{n} sound kept.",
  "{n} sons conservés.": "{n} sounds kept.",
  "{n} jour": "{n} day",
  "{n} jours": "{n} days",
  "Jamais": "Never",
  "bêta": "beta",
  "Chaque mise à jour est signée par l'équipe Onde. Les nouveaux sons arriveront sans mise à jour de l'application.": "Every update is signed by the Onde team. New sounds arrive without updating the app.",
  "Rechercher une mise à jour": "Check for updates",
  "Gratuit, et ça s'entend. Code publié sous licence AGPL-3.0.": "Free, and you can hear it. Code released under the AGPL-3.0 license.",
  "Revoir l'accueil": "Replay the welcome screen",
  "SOUTIEN BIENTÔT": "DONATIONS SOON",

  // Messages
  "Les prochains sons seront rangés dans {dir}": "New sounds will be saved in {dir}",
  "Dossier impossible à utiliser : {e}": "Can't use this folder: {e}",
  "Lecture impossible : {e}": "Can't play this sound: {e}",
  "Lecture impossible : pas de connexion, et ce son n'est pas encore sur cet ordinateur.": "Can't play this sound: you're offline, and it isn't on this computer yet.",
  "Connexion retrouvée : toute la bibliothèque est disponible.": "Back online: the whole library is available.",
  "Téléchargement du son…": "Downloading the sound…",
  "Son prêt : attrapez-le à nouveau pour le glisser.": "Sound ready: grab it again to drag it.",
  "Glisser impossible : {e}": "Can't drag this sound: {e}",
  "Le glisser-déposer vers un logiciel fonctionne dans l'application Onde, pas dans le navigateur.": "Dragging into an editing app works in the Onde app, not in the browser.",
  "Ajouté à « {name} »": "Added to “{name}”",
  "Dossier ajouté : lecture de vos sons…": "Folder added: reading your sounds…",
  "Dossier impossible à ajouter : {e}": "Can't add this folder: {e}",
  "Impossible : {e}": "Couldn't do that: {e}",
  "Mise à jour de vos sons…": "Refreshing your sounds…",
  "Impossible d'ouvrir le dossier.": "Couldn't open the folder.",
  "Le dossier sera créé au premier son utilisé.": "The folder will be created when you use your first sound.",
  "Téléchargement de la mise à jour…": "Downloading the update…",
  "Réglage impossible à enregistrer.": "Couldn't save this setting.",
  "Impossible d'ouvrir le site.": "Couldn't open the website.",
  "Impossible d'ouvrir la page.": "Couldn't open the page.",
  "Recherche d'une mise à jour…": "Checking for updates…",
  "Aucune mise à jour disponible pour l'instant.": "No update available right now.",
  "Impossible de charger la bibliothèque : {e}": "Couldn't load the library: {e}",

  // Accueil
  "Bienvenue": "Welcome",
  "Logiciels de montage": "Editing apps",
  "C'est prêt": "All set",
  "Gratuit, et ça s'entend.": "Free, and you can hear it.",
  "Bienvenue dans Onde.": "Welcome to Onde.",
  "Des bruitages et des musiques libres de droits, à glisser directement dans votre timeline. On règle deux ou trois choses et vous êtes prêt.": "Royalty-free sound effects and music to drag straight into your timeline. A couple of quick settings and you're ready.",
  "GRATUIT": "FREE",
  "SANS COMPTE": "NO ACCOUNT",
  "SONS CC0": "CC0 SOUNDS",
  "Choisissez votre mode": "Pick your mode",
  "Où ranger vos sons&nbsp;?": "Where should your sounds go?",
  "Votre logiciel de montage retrouve les sons par leur emplacement. Choisissez un dossier qui ne bougera pas.": "Your editing app finds sounds by their location. Pick a folder that won't move.",
  "Dossier Onde": "Onde folder",
  "recommandé": "recommended",
  "Un autre dossier…": "Another folder…",
  "Un disque externe ou un serveur partagé, par exemple.": "An external drive or a shared server, for example.",
  "Rien n'est téléchargé d'avance : un son arrive sur votre disque seulement quand vous l'utilisez. Vous pourrez changer de dossier dans les Réglages.": "Nothing is downloaded in advance: a sound only lands on your disk when you use it. You can change the folder later in Settings.",
  "Glissez depuis Onde, ou installez le panneau Onde dans Premiere": "Drag from Onde, or install the Onde panel in Premiere",
  "Glissez vers la timeline ou le Media Pool. Avec Resolve Studio, le panneau Onde s'installe aussi dans le logiciel.": "Drag to the timeline or the Media Pool. With Resolve Studio, the Onde panel also installs inside the app.",
  "Glissez vers le panneau Média ou la piste audio": "Drag to the Media panel or the audio track",
  "Glissez vers un chutier": "Drag to a bin",
  "Ça marche avec vos logiciels.": "It works with your apps.",
  "Attrapez un son dans Onde et lâchez-le dans votre logiciel de montage. Pour Premiere et DaVinci Resolve Studio, le panneau Onde s'installe aussi directement dans le logiciel.": "Grab a sound in Onde and drop it into your editing app. For Premiere and DaVinci Resolve Studio, the Onde panel also installs right inside the app.",
  "PRÊT": "READY",
  "Le panneau Premiere fonctionne avec Premiere Pro 2019 et plus, le panneau Resolve avec DaVinci Resolve Studio 18 et plus. Vous pourrez les installer plus tard depuis le bouton Intégrations.": "The Premiere panel works with Premiere Pro 2019 and later, the Resolve panel with DaVinci Resolve Studio 18 and later. You can install them later from the Integrations button.",
  "C'est prêt.": "You're all set.",
  "Trois gestes à retenir, et vous ne quitterez plus votre timeline.": "Three moves to remember, and you'll never leave your timeline.",
  "Chercher": "Search",
  "GLISSER": "DRAG",
  "Insérer": "Insert",
  "Essayez une première recherche": "Try a first search",
  "Commencer": "Get started",
  "Ouvrir la bibliothèque": "Open the library",
  "Continuer": "Continue",
  "Étape {i} sur {n}": "Step {i} of {n}",
  "Passer la configuration": "Skip setup",
  "Retour": "Back",

  // Contributions
  "Sans titre": "Untitled",
  "Trop long : 3 minutes au maximum.": "Too long: 3 minutes maximum.",
  "Fichier illisible : {e}": "Unreadable file: {e}",
  "titre trop court": "title too short",
  "catégorie à choisir": "pick a category",
  "Aucun son prêt à envoyer.": "No sounds ready to send.",
  "Indiquez le pseudo qui sera crédité.": "Enter the name you want to be credited as.",
  "Indiquez une adresse e-mail valide.": "Enter a valid email address.",
  "Cochez la case : vous êtes l'auteur et publiez sous CC0.": "Tick the box: you're the author and release under CC0.",
  "Son envoyé : merci !": "Sound sent: thank you!",
  "{n} sons envoyés : merci !": "{n} sounds sent: thank you!",
  "ENVOI…": "SENDING…",
  "ERREUR": "ERROR",
  "À COMPLÉTER": "INCOMPLETE",
  "À envoyer": "To send",
  "En vérification": "Under review",
  "Publiés": "Published",
  "Choisissez vos fichiers": "Choose your files",
  "WAV, FLAC, MP3, AIFF ou OGG · 3 minutes et 60 Mo au maximum par son": "WAV, FLAC, MP3, AIFF or OGG · up to 3 minutes and 60 MB per sound",
  "stéréo": "stereo",
  "Avant de proposer un son :": "Before submitting a sound:",
  "il doit venir de vous (pas d'un film, d'un jeu ou d'une autre banque de sons). Chaque son est écouté avant publication.": "it must be yours (not from a film, a game or another sound library). Every sound is listened to before it's published.",
  "Envoyé le {date}": "Sent on {date}",
  "EN VÉRIFICATION": "UNDER REVIEW",
  "PUBLIÉ": "PUBLISHED",
  "Aucun son en attente de vérification.": "No sounds waiting for review.",
  "Aucun son publié pour l'instant.": "No published sounds yet.",
  "Vos sons rejoignent la bibliothèque gratuite après une vérification, crédités à votre nom.": "Your sounds join the free library after a review, credited to your name.",
  "Vos sons vont bientôt vous rapporter.": "Your sounds will soon earn you money.",
  "Une partie des revenus d'Onde sera reversée aux créateurs, selon l'utilisation réelle de leurs sons.": "Part of Onde's revenue will go to creators, based on how much their sounds are actually used.",
  "Pseudo crédité": "Credited name",
  "ex. camille.foley": "e.g. camille.foley",
  "jamais publié": "never published",
  "Je suis l'auteur de ces sons et je les publie sous licence <b>CC0</b> : tout le monde peut les utiliser librement, même commercialement.": "I made these sounds and I release them under the <b>CC0</b> license: anyone can use them freely, even commercially.",
  "Envoi en cours…": "Sending…",
  "Envoyer {n} son": "Send {n} sound",
  "Envoyer {n} sons": "Send {n} sounds",
  "Vérification sous quelques jours. Le son apparaît ensuite dans la bibliothèque de tous les utilisateurs.": "Reviewed within a few days. The sound then appears in everyone's library.",
  "Détails du son": "Sound details",
  "Détails · {i} sur {n}": "Details · {i} of {n}",
  "Titre": "Title",
  "suggérée d'après le nom du fichier": "suggested from the file name",
  "Choisir…": "Choose…",
  "Mots-clés": "Keywords",
  "séparés par des virgules": "comma-separated",
  "cape, tissu, mouvement": "cape, cloth, movement",
  "facultative": "optional",
  "Comment le son a été enregistré…": "How the sound was recorded…",
  "Analyse du fichier…": "Analyzing the file…",
  "Analyse de {n} fichiers…": "Analyzing {n} files…",

  // Panneaux Premiere et Resolve
  "Décrivez un son : porte, whoosh, pluie…": "Describe a sound: door, whoosh, rain…",
  "Chargement de la bibliothèque…": "Loading the library…",
  "Téléchargement de « {title} »…": "Downloading “{title}”…",
  "Insertion dans la timeline…": "Inserting into the timeline…",
  "Insertion impossible : {e}": "Couldn't insert: {e}",
  "Pré-écoute indisponible dans cette version du logiciel.": "Preview isn't available in this version of the app.",
  "Pré-écoute indisponible pour ce son.": "Preview isn't available for this sound.",
  "Lâchez « {title} » dans la timeline ou le panneau Projet.": "Drop “{title}” into the timeline or the Project panel.",
  "Lâchez « {title} » dans la timeline ou le Media Pool.": "Drop “{title}” into the timeline or the Media Pool.",
  "Glissez vers la timeline, ou cliquez Insérer": "Drag to the timeline, or click Insert",
  "Cliquez Insérer pour poser le son à la tête de lecture": "Click Insert to place the sound at the playhead",
  "Afficher plus ({n})": "Show more ({n})",
  "Glissez un son vers la timeline, ou cliquez Insérer.": "Drag a sound to the timeline, or click Insert.",
  "Cliquez Insérer pour poser un son à la tête de lecture.": "Click Insert to place a sound at the playhead.",
  "panneau ouvert hors de Premiere": "panel opened outside Premiere",
  "réponse {code} du serveur": "server responded {code}",
  "téléchargement impossible ({code})": "download failed ({code})",
  "ouvrez d'abord un projet": "open a project first",
  "ouvrez une séquence dans la timeline": "open a sequence in the timeline",
  "ouvrez une timeline": "open a timeline",
  "le son n'a pas pu être importé": "the sound couldn't be imported",
  "aucune piste audio libre à la tête de lecture": "no free audio track at the playhead",
  "Premiere n'a pas répondu": "Premiere didn't respond",
  "Premiere a refusé l'insertion": "Premiere refused the insert",
  "Resolve a refusé l'insertion": "Resolve refused the insert",
  "« {title} » posé sur A{track} à {tc}.": "“{title}” placed on A{track} at {tc}.",
  "panneau ouvert hors de DaVinci Resolve": "panel opened outside DaVinci Resolve",
  "DaVinci Resolve n'a pas répondu. Le panneau Onde demande DaVinci Resolve Studio.": "DaVinci Resolve didn't respond. The Onde panel requires DaVinci Resolve Studio.",

  // Erreurs venues de l'application (Rust)
  "Pas de connexion au serveur Onde.": "Can't reach the Onde server.",
  "Le message n'a pas pu partir.": "The message couldn't be sent.",
  "Le son n'a pas pu être envoyé.": "The sound couldn't be sent.",
  "choisissez un dossier, pas la racine d'un disque": "choose a folder, not the root of a drive",
  "choisissez un dossier, pas un disque entier": "choose a folder, not a whole drive",
  "ce dossier n'existe pas": "this folder doesn't exist",
  "ce dossier contient les sons de la banque Onde : choisissez un dossier avec vos propres sons": "this folder holds the Onde library sounds: choose a folder with your own sounds",
  "ce dossier est déjà dans la liste": "this folder is already in the list",
  "le panneau n'est pas inclus dans cette version d'Onde": "the panel isn't included in this version of Onde",
  "fichier trop lourd (60 Mo au maximum)": "file too large (60 MB maximum)",
  "l'installation se fait depuis l'application Onde": "installation is done from the Onde app",
  "L'envoi fonctionne dans l'application Onde.": "Sending works in the Onde app.",
  "fichier introuvable": "file not found",
  "DaVinci Resolve n'est pas installé sur cet ordinateur (ou sa version ne gère pas les panneaux).": "DaVinci Resolve isn't installed on this computer (or its version doesn't support panels).",
  "installation annulée": "installation cancelled",
  // Compte et équipe (Onde Équipe)
  "Compte": "Account",
  "Compte et équipe": "Account and team",
  "Vous êtes connecté.": "You're signed in.",
  "SUSPENDUE": "SUSPENDED",
  "ESSAI JUSQU'AU {d}": "TRIAL UNTIL {d}",
  "ESSAI TERMINÉ": "TRIAL ENDED",
  "ACTIVE": "ACTIVE",
  "Propriétaire": "Owner",
  "Membre": "Member",
  "vous": "you",
  "Retirer le rôle de propriétaire": "Remove owner role",
  "Nommer propriétaire": "Make owner",
  "Invitation envoyée, en attente": "Invitation sent, pending",
  "Forfait {plan}": "{plan} plan",
  "{used} / {n} place": "{used} / {n} seat",
  "{used} / {n} places": "{used} / {n} seats",
  "{n} Go de stockage partagé": "{n} GB of shared storage",
  "vous êtes propriétaire": "you're an owner",
  "vous êtes membre": "you're a member",
  "E-mail à inviter": "Email to invite",
  "Inviter": "Invite",
  "Toutes les places du forfait sont prises. Pour en ajouter, écrivez-nous à {mail}.": "All the seats in your plan are taken. To add more, write to us at {mail}.",
  "Quitter l'équipe": "Leave team",
  "Entrez le code reçu": "Enter the code you received",
  "Un code à 6 chiffres a été envoyé à {email}. Il expire dans 10 minutes.": "A 6-digit code was sent to {email}. It expires in 10 minutes.",
  "Code à 6 chiffres": "6-digit code",
  "Connexion…": "Signing in…",
  "Se connecter": "Sign in",
  "Renvoyer le code": "Resend the code",
  "Changer d'adresse": "Use another email",
  "Le compte sert à rejoindre l'équipe de votre studio avec Onde Équipe. La bibliothèque reste gratuite et sans compte. Pas de mot de passe : on vous envoie un code par e-mail.": "An account lets you join your studio's team with Onde Team. The library stays free, with no account needed. No password: we email you a code.",
  "Recevoir un code": "Get a code",
  "Chargement…": "Loading…",
  "{team} vous invite à rejoindre son équipe": "{team} invited you to join their team",
  "En tant que propriétaire : vous pourrez inviter et gérer les membres.": "As an owner: you'll be able to invite and manage members.",
  "En tant que membre.": "As a member.",
  "Invitation de {who}.": "Invited by {who}.",
  "Refuser": "Decline",
  "Rejoindre": "Join",
  "Aucune équipe pour l'instant": "No team yet",
  "Onde Équipe permet à un studio de partager ses sons et ses playlists. L'offre est proposée sur demande : écrivez-nous et on vous ouvre un essai gratuit de 30 jours.": "Onde Team lets a studio share its sounds and playlists. It's available on request: write to us and we'll open a free 30-day trial for you.",
  "Nous écrire": "Contact us",
  "Connecté": "Signed in",
  "Se déconnecter": "Sign out",
  "Votre nom": "Your name",
  "Affiché aux membres de votre équipe.": "Shown to your team members.",
  "Prénom Nom": "First Last",
  "Enregistrer": "Save",
  "Supprimer mon compte": "Delete my account",
  "Votre compte et votre place dans les équipes sont effacés. Vos sons et vos réglages sur cet ordinateur ne sont pas touchés.": "Your account and your place in teams are erased. Your sounds and settings on this computer aren't touched.",
  "Supprimer définitivement": "Delete permanently",
  "Supprimer…": "Delete…",
  "Vous êtes déconnecté.": "You're signed out.",
  "Nom enregistré.": "Name saved.",
  "Bienvenue dans l'équipe {team} !": "Welcome to the {team} team!",
  "Invitation envoyée à {email}.": "Invitation sent to {email}.",
  "Invitation créée. L'e-mail n'a pas pu partir : prévenez {email} de se connecter à Onde avec cette adresse.": "Invitation created, but the email couldn't be sent: let {email} know to sign in to Onde with that address.",
  "Vous avez quitté l'équipe.": "You left the team.",
  "Onde Équipe pour notre studio": "Onde Team for our studio",
  "Compte supprimé.": "Account deleted.",
  // Équipe : sons et playlists partagés
  "Aucun son dans l'équipe pour l'instant. Cliquez sur « Ajouter des sons… », ou envoyez un de vos sons depuis « Mes sons ».": "No team sounds yet. Click “Add sounds…”, or send one of your sounds from “My sounds”.",
  "Équipe · {name}": "Team · {name}",
  "Nouvelle playlist d'équipe avec ce son": "New team playlist with this sound",
  "Ajouté par": "Added by",
  "Go": "GB",
  "Mo": "MB",
  "Équipe suspendue. Contactez Onde.": "Team suspended. Contact Onde.",
  "Essai terminé. Contactez Onde pour continuer.": "Trial ended. Contact Onde to continue.",
  "Sons de l'équipe": "Team sounds",
  "Nouvelle playlist d'équipe": "New team playlist",
  "{n} son partagé": "{n} shared sound",
  "{n} sons partagés": "{n} shared sounds",
  "{used} sur {gb} Go": "{used} of {gb} GB",
  "tout est sur cet ordinateur": "all on this computer",
  "Tout télécharger ({n})": "Download all ({n})",
  "Ajouter des sons…": "Add sounds…",
  "PARTAGÉE · {team}": "SHARED · {team}",
  "Supprimer « {name} » pour toute l'équipe ? Les sons ne sont pas effacés.": "Delete “{name}” for the whole team? The sounds themselves are not deleted.",
  "Supprimer ce son pour toute l'équipe ?": "Delete this sound for the whole team?",
  "Supprimer de l'équipe": "Delete from team",
  "Envoyer à l'équipe {name}": "Send to team {name}",
  "Playlist n°{k}": "Playlist #{k}",
  "Ajouté à la playlist de l'équipe.": "Added to the team playlist.",
  "Envoi du son à l'équipe…": "Sending the sound to the team…",
  "Son envoyé à l'équipe et ajouté à « {name} ».": "Sound sent to the team and added to “{name}”.",
  "« {title} » est maintenant dans les sons de l'équipe.": "“{title}” is now in the team's sounds.",
  "Envoi {i} sur {n}…": "Sending {i} of {n}…",
  "{n} son ajouté à l'équipe.": "{n} sound added to the team.",
  "{n} sons ajoutés à l'équipe.": "{n} sounds added to the team.",
  "Téléchargement {i} sur {n}…": "Downloading {i} of {n}…",
  "Les sons de l'équipe sont disponibles hors ligne.": "The team's sounds are available offline.",
  "Son supprimé de l'équipe.": "Sound deleted from the team.",
  "fichier trop lourd (100 Mo au maximum)": "file too large (100 MB maximum)",
  "Session expirée. Reconnectez-vous.": "Your session has expired. Please sign in again.",
  "Où chercher": "Where to search",
  "Toute la bibliothèque": "Whole library",
  "Mode testeur activé : la section Compte est visible.": "Tester mode on: the Account section is visible.",
  "Mode testeur désactivé.": "Tester mode off.",
// ---------- fin des traductions
};
