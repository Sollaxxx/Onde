"use strict";
(() => {
  // src/search.ts
  function normalize(s) {
    return s.replace(/œ/g, "oe").replace(/Œ/g, "oe").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  }
  var SYNONYMS = {
    boom: ["impact"],
    hit: ["impact"],
    trailer: ["bande-annonce"],
    door: ["porte"],
    porte: ["door"],
    rain: ["pluie"],
    wind: ["vent"],
    click: ["clic"],
    clic: ["click"],
    steps: ["pas"],
    footsteps: ["pas"],
    heart: ["coeur"],
    swoosh: ["whoosh"],
    woosh: ["whoosh"],
    whoosh: ["swoosh"],
    riser: ["montee"],
    clock: ["horloge"],
    radio: ["parasite"],
    drone: ["nappe"],
    ui: ["interface"]
  };
  var STOP = new Set("a au aux avec d de des du en et l la le les sur un une qui que dans par pour the of on in with and to for at".split(" "));
  var indexCache = /* @__PURE__ */ new WeakMap();
  var words = (s) => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);
  function indexOf(s) {
    let idx = indexCache.get(s);
    if (!idx) {
      idx = {
        title: words(`${s.title} ${s.titleEn ?? ""}`),
        tags: words(`${s.tags.join(" ")} ${s.category} ${s.code} ${s.ucs ?? ""}`),
        desc: words(`${s.description ?? ""} ${s.descriptionEn ?? ""}`)
      };
      indexCache.set(s, idx);
    }
    return idx;
  }
  function wordScore(idx, w) {
    const hit = (list) => list.some((x) => x.startsWith(w));
    const alts = [w, ...SYNONYMS[w] ?? []];
    if (alts.some((a) => idx.title.some((x) => x.startsWith(a)))) return 3;
    if (alts.some((a) => idx.tags.some((x) => x.startsWith(a)))) return 2;
    return hit(idx.desc) || alts.some((a) => idx.desc.some((x) => x.startsWith(a))) ? 1 : 0;
  }
  function search(catalog, query) {
    const qs = words(query).filter((w) => !STOP.has(w));
    if (!qs.length) return catalog;
    const scored = [];
    catalog.forEach((s, i) => {
      const idx = indexOf(s);
      let score = 0;
      for (const w of qs) {
        const k = wordScore(idx, w);
        if (!k) return;
        score += k;
      }
      scored.push({ s, score, i });
    });
    return scored.sort((a, b) => b.score - a.score || a.i - b.i).map((x) => x.s);
  }
  function formatDuration(ms) {
    const total = ms / 1e3;
    const m = Math.floor(total / 60);
    const s = total - m * 60;
    return `${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
  }

  // src/i18n.ts
  var KEY = "onde.langue";
  function systemLang() {
    try {
      const l = (navigator.languages?.[0] ?? navigator.language ?? "fr").toLowerCase();
      return l.startsWith("fr") ? "fr" : "en";
    } catch {
      return "fr";
    }
  }
  function readPref() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) ?? '"auto"');
      return v === "fr" || v === "en" ? v : "auto";
    } catch {
      return "auto";
    }
  }
  var pref = readPref();
  var lang = pref === "auto" ? systemLang() : pref;
  var getLang = () => lang;
  function t(fr, vars) {
    const s = lang === "en" ? EN[fr] ?? fr : fr;
    return vars ? s.replace(/\{(\w+)\}/g, (m, k) => k in vars ? String(vars[k]) : m) : s;
  }
  function tn(n, one, many, vars) {
    const plural = lang === "en" ? n !== 1 : n > 1;
    return t(plural ? many : one, { n, ...vars });
  }
  function collate(a, b) {
    return a.localeCompare(b, lang);
  }
  function errText(e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (lang === "fr") return msg;
    if (EN[msg]) return EN[msg];
    for (const [re, en] of ERR_PATTERNS) if (re.test(msg)) return msg.replace(re, en);
    return msg;
  }
  var soundTitle = (s) => lang === "en" && s.titleEn ? s.titleEn : s.title;
  var ERR_PATTERNS = [
    [/^dossier inaccessible : /, "folder not accessible: "],
    [/^fichier illisible : /, "unreadable file: "],
    [/^copie impossible : /, "copy failed: "],
    [/^Copie impossible /, "Copy failed "],
    [/^Téléchargement impossible : /, "Download failed: "],
    [/^Son inconnu : /, "Unknown sound: "],
    [/^Catalogue introuvable /, "Catalogue not found "],
    [/^ancien panneau impossible à remplacer \((.*)\)\. Fermez (.*) et réessayez\.$/, "the old panel could not be replaced ($1). Close $2 and try again."],
    [/^dossier des plugins Resolve inaccessible : /, "Resolve plugin folder not accessible: "]
  ];
  var EN = {
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
    "installation annulée": "installation cancelled"
    // ---------- fin des traductions
  };

  // premiere/src/ui.ts
  var CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
  var PAGE = 60;
  function startPanel(host) {
    document.documentElement.lang = getLang();
    const q = document.getElementById("q");
    if (q) q.placeholder = t("Décrivez un son : porte, whoosh, pluie…");
    const st = document.getElementById("status");
    if (st) st.textContent = t("Chargement de la bibliothèque…");
    const tag = document.querySelector(".tag");
    if (tag) tag.textContent = t("BÊTA");
    const state = {
      catalog: [],
      results: [],
      limit: PAGE,
      selId: null,
      playingId: null,
      libDir: "",
      local: /* @__PURE__ */ new Map(),
      inflight: /* @__PURE__ */ new Map(),
      busy: /* @__PURE__ */ new Set()
    };
    const $ = (id) => document.getElementById(id);
    const listEl = $("list");
    const statusEl = $("status");
    const player = $("player");
    const esc = (s) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
    const byId = (id) => state.catalog.find((s) => s.id === id) ?? null;
    const soundUrl = (s) => `${CDN}/sons/${encodeURIComponent(s.file)}`;
    function up(el, attr) {
      let n = el;
      while (n && n !== listEl) {
        if (n.getAttribute?.(attr) != null) return n;
        n = n.parentElement;
      }
      return null;
    }
    const rowOf = (el) => byId(up(el, "data-id")?.getAttribute("data-id") ?? null);
    function status(msg, kind = "") {
      statusEl.textContent = msg;
      statusEl.parentElement.className = `foot ${kind}`;
    }
    function ensureLocal(s) {
      const known = state.local.get(s.id);
      if (known) return Promise.resolve(known);
      let job = state.inflight.get(s.id);
      if (job) return job;
      const dest = [state.libDir, s.code, s.file].join(host.sep);
      job = host.download(soundUrl(s), dest).then(() => {
        state.local.set(s.id, dest);
        state.inflight.delete(s.id);
        markReady(s.id);
        return dest;
      }, (e) => {
        state.inflight.delete(s.id);
        throw e;
      });
      state.inflight.set(s.id, job);
      return job;
    }
    async function insert(s) {
      if (state.busy.has(s.id)) return;
      state.busy.add(s.id);
      renderList();
      try {
        status(t("Téléchargement de « {title} »…", { title: soundTitle(s) }));
        const path = await ensureLocal(s);
        status(t("Insertion dans la timeline…"));
        status(await host.insert(path, s.durationMs / 1e3, soundTitle(s)), "ok");
        void host.markUsed(path).catch(() => {
        });
      } catch (e) {
        status(t("Insertion impossible : {e}", { e: errText(e) }), "err");
      } finally {
        state.busy.delete(s.id);
        renderList();
      }
    }
    function togglePlay(s) {
      if (state.playingId === s.id) {
        player.pause();
        state.playingId = null;
      } else {
        player.src = soundUrl(s);
        state.playingId = s.id;
        const p = player.play();
        p?.catch?.(() => {
          state.playingId = null;
          status(t("Pré-écoute indisponible dans cette version du logiciel."), "err");
          renderList();
        });
        void ensureLocal(s).catch(() => {
        });
      }
      state.selId = s.id;
      renderList();
    }
    player.addEventListener("ended", () => {
      state.playingId = null;
      renderList();
    });
    player.addEventListener("error", () => {
      if (state.playingId) status(t("Pré-écoute indisponible pour ce son."), "err");
      state.playingId = null;
      renderList();
    });
    function markReady(id) {
      const row = listEl.querySelector(`.row[data-id="${id}"]`);
      if (row && host.canDrag) {
        row.classList.add("ready");
        row.setAttribute("draggable", "true");
      }
    }
    listEl.addEventListener("dragstart", (e) => {
      const s = rowOf(e.target);
      const path = s ? state.local.get(s.id) : void 0;
      if (!s || !path || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      if (host.startNativeDrag) {
        e.preventDefault();
        host.startNativeDrag(path);
      } else host.setDragData(e.dataTransfer, path, s);
      void host.markUsed(path).catch(() => {
      });
      status(host.dropHint ? host.dropHint(soundTitle(s)) : t("Lâchez « {title} » dans la timeline ou le panneau Projet.", { title: soundTitle(s) }));
    });
    listEl.addEventListener("mouseover", (e) => {
      if (!host.canDrag) return;
      const s = rowOf(e.target);
      if (s && !state.local.has(s.id)) void ensureLocal(s).catch(() => {
      });
    });
    function waveBars(peaks, bars = 16) {
      let out = "";
      const step = peaks.length / bars;
      for (let i = 0; i < bars; i++) {
        const slice = peaks.slice(Math.floor(i * step), Math.max(Math.floor((i + 1) * step), Math.floor(i * step) + 1));
        const h = Math.max(2, Math.round(Math.max(...slice) * 20));
        out += `<i style="height:${h}px"></i>`;
      }
      return out;
    }
    function renderList() {
      const list = state.results.slice(0, state.limit);
      if (!list.length) {
        listEl.innerHTML = `<p class="empty">${t("Aucun son ne correspond. Essayez « porte », « impact » ou « pluie ».")}</p>`;
        return;
      }
      const hint = host.canDrag ? t("Glissez vers la timeline, ou cliquez Insérer") : t("Cliquez Insérer pour poser le son à la tête de lecture");
      const rows = list.map((s) => {
        const sel = s.id === state.selId;
        const playing = s.id === state.playingId;
        const ready = host.canDrag && state.local.has(s.id);
        const busy = state.busy.has(s.id);
        return `<div class="row${sel ? " sel" : ""}${ready ? " ready" : ""}" data-id="${s.id}" draggable="${ready}" title="${hint}">
        <button class="play${playing ? " on" : ""}" data-act="play">${playing ? "❚❚" : "▶"}</button>
        <div class="info"><b>${esc(soundTitle(s))}</b><span>${esc(s.code)} · ${esc(s.tags.slice(0, 4).join(" · "))}</span></div>
        <div class="wave">${waveBars(s.peaks)}</div>
        <span class="dur mono muted">${formatDuration(s.durationMs)}</span>
        <button class="ins" data-act="insert" ${busy ? "disabled" : ""}>${busy ? "…" : t("Insérer")}</button>
      </div>`;
      }).join("");
      const more = state.results.length > state.limit ? `<button class="more" data-act="more">${t("Afficher plus ({n})", { n: state.results.length - state.limit })}</button>` : "";
      const top = listEl.scrollTop;
      listEl.innerHTML = rows + more;
      listEl.scrollTop = top;
    }
    function runSearch(q2) {
      state.results = search(state.catalog, q2);
      state.limit = PAGE;
      $("count").textContent = tn(state.results.length, "{n} SON", "{n} SONS");
      listEl.scrollTop = 0;
      renderList();
    }
    listEl.addEventListener("click", (e) => {
      const act = up(e.target, "data-act")?.getAttribute("data-act");
      if (act === "more") {
        state.limit += PAGE * 2;
        renderList();
        return;
      }
      const s = rowOf(e.target);
      if (!s) return;
      if (act === "play") togglePlay(s);
      else if (act === "insert") void insert(s);
      else {
        state.selId = s.id;
        renderList();
      }
    });
    listEl.addEventListener("dblclick", (e) => {
      const s = rowOf(e.target);
      if (s) void insert(s);
    });
    let timer;
    $("q").addEventListener("input", (e) => {
      const v = e.target.value;
      clearTimeout(timer);
      timer = setTimeout(() => runSearch(v), 120);
    });
    void (async () => {
      try {
        state.libDir = await host.libraryDir();
        const data = await host.getJson(`${CDN}/catalogue/v1.json`);
        state.catalog = data.sounds.sort((a, b) => collate(soundTitle(a), soundTitle(b)));
        runSearch("");
        status(host.canDrag ? t("Glissez un son vers la timeline, ou cliquez Insérer.") : t("Cliquez Insérer pour poser un son à la tête de lecture."));
      } catch (e) {
        status(t("Impossible de charger la bibliothèque : {e}", { e: errText(e) }), "err");
      }
    })();
  }

  // resolve/src/host-resolve.ts
  var ERRORS = {
    "hors-resolve": "panneau ouvert hors de DaVinci Resolve",
    "pas-de-reponse": "DaVinci Resolve n'a pas répondu. Le panneau Onde demande DaVinci Resolve Studio.",
    noproject: "ouvrez d'abord un projet",
    notimeline: "ouvrez une timeline",
    import: "le son n'a pas pu être importé",
    refused: "Resolve a refusé l'insertion"
  };
  function errorText(code) {
    const http = /^http-(\d+)$/.exec(code);
    if (http) return t("réponse {code} du serveur", { code: http[1] });
    return ERRORS[code] ? t(ERRORS[code]) : code;
  }
  async function call(reply) {
    const r = await reply;
    if (!r.ok) throw new Error(errorText(r.error));
    return r.value;
  }
  var bridge = window.onde;
  if (!bridge) {
    document.getElementById("status").textContent = t(ERRORS["hors-resolve"]);
  } else {
    const host = {
      canDrag: true,
      sep: bridge.sep,
      libraryDir: () => call(bridge.libraryDir()),
      getJson: (url) => call(bridge.getJson(url)),
      download: (url, dest) => call(bridge.download(url, dest)),
      async insert(file, durationSec, title) {
        const r = await call(bridge.insert(file, durationSec));
        return t("« {title} » posé sur A{track} à {tc}.", { title, track: r.track, tc: r.timecode });
      },
      markUsed: (file) => call(bridge.markUsed(file)),
      setDragData() {
      },
      startNativeDrag: (file) => bridge.startDrag(file),
      dropHint: (title) => t("Lâchez « {title} » dans la timeline ou le Media Pool.", { title })
    };
    startPanel(host);
  }
})();
