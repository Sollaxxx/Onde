# Onde

**Gratuit, et ça s'entend.**

Onde est une application de bureau gratuite et open source pour les monteurs vidéo : on cherche un bruitage ou une musique libre de droits, on l'écoute, puis on le glisse directement dans la timeline de son logiciel de montage (Premiere Pro, DaVinci Resolve, CapCut, Avid…).

> Onde est en **bêta**, sur Windows et sur Mac (Intel et Apple Silicon).

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
