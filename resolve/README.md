# Panneau Onde pour DaVinci Resolve Studio

Un panneau dans DaVinci Resolve pour chercher, écouter et poser les sons d'Onde sans quitter le logiciel. Même interface que le panneau Premiere (`premiere/src/ui.ts`).

- **Insérer** (ou double-clic) : pose le son à la tête de lecture, sur la première piste audio libre (une nouvelle piste si toutes sont prises). Le son est rangé dans un chutier « Onde » du Media Pool, importé une seule fois.
- **Glisser-déposer** : glissez une ligne vers la timeline ou le Media Pool.
- Les sons vont dans le même dossier que l'application Onde ; ceux posés ou glissés depuis le panneau ne sont jamais effacés par le nettoyage automatique.

**Resolve Studio uniquement** : Blackmagic réserve les panneaux (« Workflow Integration Plugins ») à la version payante. Avec Resolve gratuit, on glisse les sons depuis l'application Onde.

## Installation

Depuis l'application Onde : bouton **Intégrations → DaVinci Resolve Studio → Installer**, puis redémarrer Resolve et ouvrir **Espace de travail → Intégrations de workflow → Onde**.

L'application copie `plugin/` dans le dossier des panneaux de Resolve :

- Windows : `%PROGRAMDATA%\Blackmagic Design\DaVinci Resolve\Support\Workflow Integration Plugins\com.ondesound.resolve`
- macOS : `/Library/Application Support/Blackmagic Design/DaVinci Resolve/Workflow Integration Plugins/com.ondesound.resolve` (mot de passe administrateur demandé)

et y ajoute `WorkflowIntegration.node`, le module de Blackmagic qui relie le panneau à Resolve. Il n'est pas dans ce dépôt : il est pris dans l'installation de Resolve (`Developer/Workflow Integrations/Examples/SamplePlugin/`).

## Fichiers

| Fichier | Rôle |
| --- | --- |
| `plugin/main.js` | Processus principal Electron : fichiers, réseau, appels à Resolve (import, insertion, glisser) |
| `plugin/preload.js` | Pont vers l'interface (modèle « sandbox » exigé depuis Resolve 19.0.2) |
| `plugin/manifest.xml` | Identifiant et version lus par Resolve |
| `src/host-resolve.ts` | Branche l'interface commune sur `preload.js` → construit `plugin/renderer.js` |

Après une modification : `npm run resolve` (aussi lancé par `npm run build`).
