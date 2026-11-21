"use strict";
(() => {
  var __require = /* @__PURE__ */ ((x) => typeof require !== "undefined" ? require : typeof Proxy !== "undefined" ? new Proxy(x, {
    get: (a, b) => (typeof require !== "undefined" ? require : a)[b]
  }) : x)(function(x) {
    if (typeof require !== "undefined") return require.apply(this, arguments);
    throw Error('Dynamic require of "' + x + '" is not supported');
  });

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
    var _a;
    try {
      const l = (((_a = navigator.languages) == null ? void 0 : _a[0]) ?? navigator.language ?? "fr").toLowerCase();
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
  function setLangPref(p, save = true) {
    pref = p;
    lang = p === "auto" ? systemLang() : p;
    if (save) try {
      localStorage.setItem(KEY, JSON.stringify(p));
    } catch {
    }
  }
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
    "Mode testeur désactivé.": "Tester mode off."
    // ---------- fin des traductions
  };

  // premiere/src/ui.ts
  var CDN = "https://pub-fd954b41e9a74a869ad359c2b577f7a3.r2.dev";
  var SITE = "https://ondesound.com";
  function folderName(name) {
    const clean = [...name].map((c) => c.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(c) ? "_" : c).join("").trim().replace(/^\.+|\.+$/g, "").trim().slice(0, 60);
    return clean || "Equipe";
  }
  function teamFileName(id, fileName) {
    const dot = fileName.lastIndexOf(".");
    const stem = folderName(dot > 0 ? fileName.slice(0, dot) : fileName);
    const ext = dot > 0 ? fileName.slice(dot + 1).toLowerCase() : "";
    return `${stem}_${id.slice(0, 8)}.${ext && ext.length <= 5 && /^[a-z0-9]+$/.test(ext) ? ext : "wav"}`;
  }
  var PAGE = 60;
  function startPanel(host2) {
    document.documentElement.lang = getLang();
    const q = document.getElementById("q");
    if (q) q.placeholder = t("Décrivez un son : porte, whoosh, pluie…");
    const st = document.getElementById("status");
    if (st) st.textContent = t("Chargement de la bibliothèque…");
    const tag = document.querySelector(".tag");
    if (tag) tag.textContent = t("BÊTA");
    const state = {
      catalog: [],
      team: null,
      teamSounds: [],
      scope: "all",
      // "all", "team:<id>" ou "pl:<id>"
      query: "",
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
    const index = /* @__PURE__ */ new Map();
    const byId = (id) => id ? index.get(id) ?? null : null;
    const soundUrl = (s) => s.remote ?? `${CDN}/sons/${encodeURIComponent(s.file)}`;
    const reindex = () => {
      index.clear();
      for (const s of [...state.catalog, ...state.teamSounds]) index.set(s.id, s);
    };
    function up(el, attr) {
      var _a;
      let n = el;
      while (n && n !== listEl) {
        if (((_a = n.getAttribute) == null ? void 0 : _a.call(n, attr)) != null) return n;
        n = n.parentElement;
      }
      return null;
    }
    const rowOf = (el) => {
      var _a;
      return byId(((_a = up(el, "data-id")) == null ? void 0 : _a.getAttribute("data-id")) ?? null);
    };
    function status(msg, kind = "") {
      statusEl.textContent = msg;
      statusEl.parentElement.className = `foot ${kind}`;
    }
    function ensureLocal(s) {
      var _a, _b;
      const known = state.local.get(s.id);
      if (known) return Promise.resolve(known);
      let job = state.inflight.get(s.id);
      if (job) return job;
      const teamName = s.team ? ((_b = (_a = state.team) == null ? void 0 : _a.teams.find((x) => x.id === s.team)) == null ? void 0 : _b.name) ?? "" : "";
      const dest = s.team ? [state.libDir, "Equipes", folderName(teamName), teamFileName(s.id.slice(3), s.file)].join(host2.sep) : [state.libDir, s.code, s.file].join(host2.sep);
      job = host2.download(soundUrl(s), dest).then(() => {
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
        const path2 = await ensureLocal(s);
        status(t("Insertion dans la timeline…"));
        status(await host2.insert(path2, s.durationMs / 1e3, soundTitle(s)), "ok");
        void host2.markUsed(path2).catch(() => {
        });
      } catch (e) {
        status(t("Insertion impossible : {e}", { e: errText(e) }), "err");
      } finally {
        state.busy.delete(s.id);
        renderList();
      }
    }
    function togglePlay(s) {
      var _a;
      if (state.playingId === s.id) {
        player.pause();
        state.playingId = null;
      } else {
        player.src = soundUrl(s);
        state.playingId = s.id;
        const p = player.play();
        (_a = p == null ? void 0 : p.catch) == null ? void 0 : _a.call(p, () => {
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
      if (row && host2.canDrag) {
        row.classList.add("ready");
        row.setAttribute("draggable", "true");
      }
    }
    listEl.addEventListener("dragstart", (e) => {
      const s = rowOf(e.target);
      const path2 = s ? state.local.get(s.id) : void 0;
      if (!s || !path2 || !e.dataTransfer) {
        e.preventDefault();
        return;
      }
      if (host2.startNativeDrag) {
        e.preventDefault();
        host2.startNativeDrag(path2);
      } else host2.setDragData(e.dataTransfer, path2, s);
      void host2.markUsed(path2).catch(() => {
      });
      status(host2.dropHint ? host2.dropHint(soundTitle(s)) : t("Lâchez « {title} » dans la timeline ou le panneau Projet.", { title: soundTitle(s) }));
    });
    listEl.addEventListener("mouseover", (e) => {
      if (!host2.canDrag) return;
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
      const hint = host2.canDrag ? t("Glissez vers la timeline, ou cliquez Insérer") : t("Cliquez Insérer pour poser le son à la tête de lecture");
      const rows = list.map((s) => {
        const sel = s.id === state.selId;
        const playing = s.id === state.playingId;
        const ready = host2.canDrag && state.local.has(s.id);
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
    function scopeList() {
      var _a;
      if (state.scope.startsWith("team:")) return state.teamSounds.filter((s) => s.team === state.scope.slice(5));
      if (state.scope.startsWith("pl:")) {
        const p = (_a = state.team) == null ? void 0 : _a.playlists.find((x) => x.id === state.scope.slice(3));
        return ((p == null ? void 0 : p.ids) ?? []).map((id) => byId(id)).filter((s) => !!s);
      }
      return [...state.catalog, ...state.teamSounds];
    }
    function runSearch(q2) {
      state.query = q2;
      state.results = search(scopeList(), q2);
      state.limit = PAGE;
      $("count").textContent = tn(state.results.length, "{n} SON", "{n} SONS");
      listEl.scrollTop = 0;
      renderList();
    }
    listEl.addEventListener("click", (e) => {
      var _a;
      const act = (_a = up(e.target, "data-act")) == null ? void 0 : _a.getAttribute("data-act");
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
    function scopeMenu() {
      var _a, _b, _c;
      let sel = document.getElementById("scope");
      if (!((_a = state.team) == null ? void 0 : _a.teams.length)) {
        sel == null ? void 0 : sel.remove();
        state.scope = "all";
        return;
      }
      if (!sel) {
        sel = document.createElement("select");
        sel.id = "scope";
        sel.setAttribute("aria-label", t("Où chercher"));
        sel.addEventListener("change", () => {
          state.scope = sel.value;
          runSearch(state.query);
        });
        (_c = (_b = document.getElementById("q")) == null ? void 0 : _b.parentElement) == null ? void 0 : _c.appendChild(sel);
      }
      const opts = [`<option value="all">${t("Toute la bibliothèque")}</option>`];
      for (const team of state.team.teams) {
        opts.push(`<option value="team:${team.id}">${esc(t("Équipe · {name}", { name: team.name }))}</option>`);
        for (const p of state.team.playlists.filter((x) => x.teamId === team.id)) opts.push(`<option value="pl:${p.id}">— ${esc(p.name)}</option>`);
      }
      sel.innerHTML = opts.join("");
      if (![...sel.options].some((o) => o.value === state.scope)) state.scope = "all";
      sel.value = state.scope;
    }
    async function loadTeam() {
      if (!host2.teamContent) return;
      try {
        const c = await host2.teamContent();
        state.team = c;
        const names = new Map(((c == null ? void 0 : c.teams) ?? []).map((x) => [x.id, x.name]));
        state.teamSounds = ((c == null ? void 0 : c.sounds) ?? []).map((r) => ({
          id: `eq-${r.id}`,
          title: r.title,
          titleEn: r.title,
          code: "EQP",
          category: names.get(r.teamId) ?? "",
          tags: r.tags ?? [],
          durationMs: r.durationMs,
          file: r.fileName,
          format: r.format,
          license: "Son de l'équipe",
          peaks: r.peaks ?? [],
          team: r.teamId,
          remote: r.url
        }));
        reindex();
        scopeMenu();
        if (state.catalog.length) runSearch(state.query);
      } catch {
      }
    }
    setInterval(() => void loadTeam(), 10 * 6e4);
    window.addEventListener("focus", () => void loadTeam());
    void (async () => {
      try {
        state.libDir = await host2.libraryDir();
        const data = await host2.getJson(`${CDN}/catalogue/v1.json`);
        state.catalog = data.sounds.sort((a, b) => collate(soundTitle(a), soundTitle(b)));
        reindex();
        runSearch("");
        void loadTeam();
        status(host2.canDrag ? t("Glissez un son vers la timeline, ou cliquez Insérer.") : t("Cliquez Insérer pour poser un son à la tête de lecture."));
      } catch (e) {
        status(t("Impossible de charger la bibliothèque : {e}", { e: errText(e) }), "err");
      }
    })();
  }

  // premiere/src/host-cep.ts
  var fs = __require("fs");
  var os = __require("os");
  var path = __require("path");
  var https = __require("https");
  var isWin = process.platform === "win32";
  function evalScript(code) {
    return new Promise((resolve, reject) => {
      const cep = window.__adobe_cep__;
      if (!cep) {
        reject(new Error(t("panneau ouvert hors de Premiere")));
        return;
      }
      cep.evalScript(code, (res) => resolve(res));
    });
  }
  function get(url, redirects = 3, extra = {}) {
    return new Promise((resolve, reject) => {
      https.get(url, { headers: { "User-Agent": "Onde-Premiere", ...extra } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location && redirects > 0) {
          res.resume();
          resolve(get(res.headers.location, redirects - 1));
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          reject(new Error(t("réponse {code} du serveur", { code: res.statusCode })));
          return;
        }
        resolve(res);
      }).on("error", reject);
    });
  }
  var ERRORS = {
    noproject: "ouvrez d'abord un projet",
    nosequence: "ouvrez une séquence dans la timeline",
    import: "le son n'a pas pu être importé",
    notrack: "aucune piste audio libre à la tête de lecture"
  };
  var errorText = (code) => ERRORS[code] ? t(ERRORS[code]) : code;
  function timecode(sec) {
    const m = Math.floor(sec / 60), s = Math.floor(sec % 60);
    return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  function applyHostTheme() {
    try {
      const env = JSON.parse(window.__adobe_cep__.getHostEnvironment());
      const c = env.appSkinInfo.panelBackgroundColor.color;
      const rgb = `rgb(${Math.round(c.red)}, ${Math.round(c.green)}, ${Math.round(c.blue)})`;
      document.documentElement.style.setProperty("--bg", rgb);
      const light = (c.red + c.green + c.blue) / 3 > 128;
      if (light) {
        document.documentElement.style.setProperty("--ink", "#1b1b1b");
        document.documentElement.style.setProperty("--muted", "#5e5e5e");
        document.documentElement.style.setProperty("--line", "#c8c8c8");
      }
    } catch {
    }
  }
  function configDir() {
    const home = os.homedir();
    return isWin ? path.join(process.env.APPDATA || path.join(home, "AppData", "Roaming"), "app.onde.desktop") : path.join(home, "Library", "Application Support", "app.onde.desktop");
  }
  async function readJson(res) {
    const chunks = [];
    for await (const c of res) chunks.push(c);
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  }
  async function teamContent() {
    let token = "";
    try {
      token = JSON.parse(fs.readFileSync(path.join(configDir(), "session.json"), "utf8")).token || "";
    } catch {
      return null;
    }
    if (!token) return null;
    const auth = { Authorization: `Bearer ${token}` };
    const me = await readJson(await get(`${SITE}/api/compte/moi`, 0, auth)).catch(() => null);
    const teams = ((me == null ? void 0 : me.teams) ?? []).filter((x) => x.active);
    if (!teams.length) return null;
    const out = { teams: teams.map((x) => ({ id: x.id, name: x.name })), sounds: [], playlists: [] };
    for (const team of teams) {
      const c = await readJson(await get(`${SITE}/api/equipe/${team.id}/contenu`, 0, auth)).catch(() => null);
      if (!(c == null ? void 0 : c.ok)) continue;
      for (const snd of c.sounds) out.sounds.push({ ...snd, teamId: team.id });
      for (const p of c.playlists) out.playlists.push({ ...p, teamId: team.id });
    }
    return out;
  }
  var host = {
    teamContent,
    canDrag: true,
    sep: path.sep,
    async libraryDir() {
      const home = os.homedir();
      const cfg = configDir();
      try {
        const hint = fs.readFileSync(path.join(cfg, "bibliotheque.txt"), "utf8").trim();
        if (hint) return hint;
      } catch {
      }
      for (const docs of [path.join(home, "Documents"), path.join(home, "OneDrive", "Documents")]) {
        if (fs.existsSync(path.join(docs, "Onde"))) return path.join(docs, "Onde");
      }
      return path.join(home, "Documents", "Onde");
    },
    async getJson(url) {
      return readJson(await get(url));
    },
    async download(url, dest) {
      if (fs.existsSync(dest)) return;
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      const part = `${dest}.part`;
      const res = await get(url);
      await new Promise((resolve, reject) => {
        const out = fs.createWriteStream(part);
        res.pipe(out);
        out.on("finish", () => out.close(() => resolve()));
        out.on("error", reject);
        res.on("error", reject);
      });
      fs.renameSync(part, dest);
    },
    async insert(file, durationSec, title) {
      const raw = await evalScript(`ondeInsert(${JSON.stringify(file)}, ${durationSec})`);
      let res;
      try {
        res = JSON.parse(raw);
      } catch {
        throw new Error(raw || t("Premiere n'a pas répondu"));
      }
      if (!res.ok) throw new Error(errorText(res.error));
      return t("« {title} » posé sur A{track} à {tc}.", { title, track: res.track + 1, tc: timecode(res.start) });
    },
    async markUsed(file) {
      const cfg = configDir();
      fs.mkdirSync(cfg, { recursive: true });
      fs.appendFileSync(path.join(cfg, "sons-glisses.txt"), file + "\n", "utf8");
    },
    setDragData(dt, file, _sound) {
      dt.setData("com.adobe.cep.dnd.file.0", file);
      dt.effectAllowed = "copy";
    }
  };
  function applyHostLanguage() {
    try {
      const loc = String(JSON.parse(window.__adobe_cep__.getHostEnvironment()).appUILocale || "");
      if (loc) setLangPref(loc.toLowerCase().startsWith("fr") ? "fr" : "en", false);
    } catch {
    }
  }
  applyHostTheme();
  applyHostLanguage();
  startPanel(host);
})();
