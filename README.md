# Onde

**Gratuit, et ça s'entend.**

Onde est une application de bureau gratuite et open source pour les monteurs vidéo : on cherche un bruitage ou une musique libre de droits, on l'écoute, puis on le glisse directement dans la timeline de son logiciel de montage (Premiere Pro, DaVinci Resolve, CapCut, Avid…).

> Onde est en **bêta**, sur Windows et sur Mac (Intel et Apple Silicon). Téléchargement : **[ondesound.com](https://ondesound.com)**

*[English below ↓](#english)*

## Ce que fait Onde

- Une **bibliothèque en ligne** de sons libres de droits, classés par catégories (UCS).
- Une **recherche instantanée** en français et en anglais, sans souci des accents et avec synonymes (« porte », « door », « boom »…).
- Une **pré-écoute immédiate** avec forme d'onde, sans attendre le téléchargement.
- Le **glisser-déposer** vers n'importe quel logiciel : attrapez une ligne, la forme d'onde ou le bouton bleu, puis lâchez le son dans votre timeline.
- Chaque son utilisé est copié dans un dossier stable, rangé par catégorie (par défaut `Documents\Onde`, modifiable dans les réglages), pour que votre projet de montage ne le perde jamais.
- Un mode clair, un mode sombre et un mode compact (petite fenêtre toujours au premier plan, pratique sur un deuxième écran).
- Les **mises à jour automatiques** : Onde vous propose lui-même chaque nouvelle version.
- Des raccourcis : `Ctrl K` (`⌘ K` sur Mac) chercher · `Espace` écouter · `↑ ↓` naviguer · `F` favori · `Échap` fermer.

## Installer

Tout se trouve sur la page [Releases](../../releases/latest).

**Windows** : téléchargez `Onde_x.y.z_x64-setup.exe`, puis lancez-le. Tant qu'Onde n'est pas signé par un certificat commercial, Windows peut afficher un avertissement SmartScreen : cliquez sur **Informations complémentaires**, puis sur **Exécuter quand même**.

**Mac** (Intel et Apple Silicon, macOS 11 ou plus récent) : téléchargez `Onde_x.y.z_universal.dmg`, ouvrez-le et glissez Onde dans Applications. Onde n'est pas encore signé par Apple : au premier lancement, macOS le bloque. Ouvrez **Réglages Système → Confidentialité et sécurité**, puis cliquez sur **Ouvrir quand même** en bas de la page. C'est à faire une seule fois.

## Compiler depuis les sources

À installer une seule fois :
1. **Node.js** (version LTS) : https://nodejs.org
2. **Rust** : https://rustup.rs
3. Sous Windows, **Visual Studio Build Tools** avec la charge de travail « Développement Desktop en C++ ». Pour les autres systèmes, voir les [prérequis Tauri](https://tauri.app/start/prerequisites/).

Puis, dans le dossier du projet :

```bash
npm install
```

```bash
npm run tauri dev
```

Pour tester seulement l'interface dans un navigateur, sans glisser-déposer vers un logiciel :

```bash
npm run dev
```

## Organisation du code

```
onde/
├── index.html, src/        Interface (TypeScript, sans framework)
│   ├── main.ts             Bibliothèque, écoute, glisser-déposer, réglages
│   ├── api.ts              Pont vers le cœur natif
│   ├── search.ts           Recherche, classement et synonymes
│   └── styles.css          Charte graphique (clair et sombre)
├── src-tauri/              Cœur natif (Rust, Tauri 2)
│   ├── src/lib.rs          Catalogue, téléchargement des sons, dossier de bibliothèque
│   ├── tauri.conf.json     Fenêtre, sécurité, installateur, mises à jour
│   └── capabilities/       Permissions accordées à l'interface
├── scripts/                Numéro de version, import des sons libres
└── site/                   Site web
```

## Les sons

Les sons proposés sont sous licence **CC0** (domaine public) : vous pouvez les utiliser librement, y compris dans des projets commerciaux.

La bibliothèque actuelle doit beaucoup à **[BigSoundBank](https://bigsoundbank.com) – Joseph Sardin**, crédité sur chaque son avec un lien vers sa page d'origine.

## Contribuer

Les retours, les bugs et les idées sont les bienvenus dans les [Issues](../../issues). Les contributions de code sont acceptées sous réserve de signer l'accord de contribution (CLA).

## Licence

Le code est publié sous licence **GNU AGPL-3.0** (voir [`LICENSE`](LICENSE)).

**Le nom « Onde » et le logo Onde ne sont pas couverts par la licence AGPL.** Une version modifiée de ce logiciel doit porter un autre nom et un autre logo.

---

## English

**Onde** is a free, open-source desktop app for video editors. Search for a royalty-free sound effect, preview it instantly, and drag it straight into your timeline: Premiere Pro, DaVinci Resolve, Final Cut, CapCut, Avid or any editor that accepts a dropped file.

> Onde is in **beta**, on Windows and Mac (Intel and Apple Silicon). Download: **[ondesound.com](https://ondesound.com/en/)**

### What it does

- An **online library of 6,000+ CC0 sounds** in 81 categories: free for commercial use, no credit needed.
- **Instant search** in English and French, accent-insensitive, with synonyms (“boom” finds impacts, “footsteps” finds steps).
- **Instant preview** with a waveform, before anything is downloaded.
- **Drag and drop** into any editor: grab a row, the waveform or the blue button and drop it on your timeline.
- **Never lose a sound**: every sound you use is copied to a stable folder, sorted by category (`Documents/Onde` by default, changeable in Settings), so your editing projects always find it.
- **Your own sounds**: add your sound folders and search them next to the library. Files stay where they are.
- **Playlists** and one-click likes, for each project or client.
- **Compact mode**: a small always-on-top window, handy next to your editor or on a second screen. Light and dark modes too.
- **Offline mode**: sounds you already used keep working without internet.
- A **panel inside Premiere Pro** (2019 and later), installable in one click from the app.
- **Automatic updates**, signed by the Onde team.

### Install

Everything is on the [Releases](../../releases/latest) page.

**Windows**: download `Onde_x.y.z_x64-setup.exe` and run it. Until Onde is signed with a commercial certificate, SmartScreen may warn you: click **More info**, then **Run anyway**.

**Mac** (Intel and Apple Silicon, macOS 11 or later): download `Onde_x.y.z_universal.dmg`, open it and drag Onde into Applications. Onde isn't signed by Apple yet, so macOS blocks the first launch: open **System Settings → Privacy & Security** and click **Open Anyway** at the bottom. You only do this once.

The full source code is in this repository: you can read exactly what the app does before running it.

### License

Code under **GNU AGPL-3.0** (see [`LICENSE`](LICENSE)). The name “Onde” and the Onde logo are not covered by the AGPL: a modified version must use another name and logo. Library sounds are CC0.

