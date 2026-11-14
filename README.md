# Onde

**Gratuit, et ça s'entend.**

Onde est une application de bureau gratuite et open-source : on cherche un bruitage ou une musique libre de droits, on l'écoute, puis on le glisse directement dans la timeline de son logiciel de montage (Premiere Pro, DaVinci Resolve, Final Cut, CapCut, Avid…).

> État : **prototype 0.1** (phase 2 du plan de route). La bibliothèque contient 16 sons de test générés ; le serveur de sons arrive en phase 5.

## Ce que fait le prototype

- Recherche instantanée, sans accents et avec synonymes français/anglais (« porte », « door », « boom »…).
- Catégories UCS, favoris et récents.
- Pré-écoute avec forme d'onde et tête de lecture.
- **Glisser-déposer système** : attrapez une ligne, la forme d'onde ou le bouton bleu, et lâchez le son dans n'importe quel logiciel.
- Chaque son utilisé est copié dans un dossier stable, `Documents\Onde\<CODE UCS>\`, pour que votre projet de montage ne le perde jamais.
- Mode clair et mode sombre, et mode compact (petite fenêtre toujours au premier plan, pour un deuxième écran).
- Module de mise à jour signé, prêt à activer (voir plus bas).
- Raccourcis : `Ctrl K` chercher · `Espace` écouter · `↑ ↓` naviguer · `F` favori · `Échap` fermer.

## Lancer Onde sur Windows

### Option A : sans rien installer

Sur GitHub, onglet **Actions**, ouvrez **Installateur Windows**, puis **Run workflow**. Une dizaine de minutes plus tard, l'installateur `.exe` est téléchargeable en bas de la page de l'exécution.

### Option B : sur votre PC (pour développer)

Installez une seule fois :
1. **Node.js** (version LTS) : https://nodejs.org
2. **Rust** : https://rustup.rs
3. **Visual Studio Build Tools**, avec la charge de travail « Développement Desktop en C++ ».

WebView2 est déjà présent sur Windows 10 et 11.

Puis, dans le dossier du projet :

```bash
npm install
```

```bash
npm run tauri dev
```

Pour fabriquer l'installateur (`src-tauri/target/release/bundle/nsis/`) :

```bash
npm run tauri build
```

Pour tester seulement l'interface dans un navigateur (sans glisser-déposer vers un logiciel) :

```bash
npm run dev
```

## À tester en priorité (phase 2)

Glissez un son depuis Onde vers chacun de ces logiciels et notez le résultat :

| Logiciel | Vers la timeline | Vers le panneau média |
| --- | --- | --- |
| Premiere Pro | | |
| DaVinci Resolve | | |
| CapCut | | |
| Avid Media Composer | | |

## Organisation du code

```
onde/
├── index.html, src/            Interface (TypeScript, sans framework)
│   ├── main.ts                 Écran bibliothèque, lecture, glisser-déposer, raccourcis
│   ├── api.ts                  Pont vers le cœur natif (et mode navigateur)
│   ├── search.ts               Recherche et synonymes
│   └── styles.css              Charte Onde (clair et sombre)
├── src-tauri/                  Cœur natif (Rust, Tauri 2)
│   ├── src/lib.rs              Catalogue, dossier Documents\Onde, chemins
│   ├── tauri.conf.json         Fenêtre, sécurité, installateur, mises à jour
│   ├── capabilities/           Permissions accordées à l'interface
│   └── resources/samples/      Sons de test + catalog.json
└── scripts/generer-sons-test.py  Regénère les sons de test (ffmpeg)
```

## Publier une nouvelle version

Les applications installées vérifient au démarrage s'il existe une version plus récente, signée avec la clé d'Onde, et proposent « Installer et redémarrer ».

1. Changer le numéro de version :
   ```bash
   node scripts/version.mjs 0.3.0
   ```
2. Faire un commit et le fusionner dans `main`.
3. Sur GitHub, onglet **Actions → Publier une version → Run workflow**.

GitHub compile l'installateur, le signe, puis crée la version `v0.3.0` avec le fichier `latest.json` que lisent les applications.

La clé privée de signature est rangée dans les secrets du dépôt (`TAURI_SIGNING_PRIVATE_KEY` et `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`). ⚠️ Elle ne doit **jamais** être dans le dépôt, et doit être sauvegardée à deux endroits : sans elle, les applications déjà installées ne peuvent plus être mises à jour.

Pour fabriquer un installateur sur votre PC (`npm run tauri build`), les deux mêmes variables doivent être définies dans votre terminal. Pour développer (`npm run tauri dev`), elles ne sont pas nécessaires.

## Licence

Le code est publié sous licence **GNU AGPL-3.0** (voir `LICENSE`). Les contributions sont acceptées sous réserve de signer l'accord de contribution (CLA).

**Le nom « Onde » et le logo Onde ne sont pas couverts par la licence AGPL.** Une version modifiée de ce logiciel doit porter un autre nom et un autre logo.

Les sons de test fournis dans `src-tauri/resources/samples` sont générés par synthèse et placés dans le domaine public (CC0).
