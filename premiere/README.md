# Panneau Onde pour Premiere Pro

Un panneau dans Premiere Pro pour chercher, écouter et poser les sons d'Onde sans quitter le logiciel.

- **Insérer** (ou double-clic) : pose le son à la tête de lecture, sur la première piste audio libre. Aucun clip existant n'est déplacé. Le son est rangé dans un chutier « Onde » du projet, et importé une seule fois.
- **Glisser-déposer** : glissez une ligne vers la timeline ou le panneau Projet.
- Les sons sont enregistrés dans le même dossier que l'application Onde : un son déjà utilisé n'est jamais retéléchargé.

Deux versions, une seule interface (`src/ui.ts`) :

| Dossier | Technologie | Premiere Pro |
| --- | --- | --- |
| `cep/` | CEP (HTML + ExtendScript) | **2019 et plus** (2022, 2023, 2024, 2025…) |
| `uxp/` | UXP | 25.6 et plus (glisser-déposer : 27 et plus) |

## Installer la version CEP sur Windows

Double-cliquez sur `installer-windows.bat`, redémarrez Premiere Pro, puis **Fenêtre → Extensions → Onde**.

Le script copie le dossier `cep` dans `%APPDATA%\Adobe\CEP\extensions\app.onde.premiere` et autorise les panneaux non signés (le panneau n'est pas encore signé).

## Essayer la version UXP

1. Installez **UXP Developer Tools** depuis l'application Creative Cloud et acceptez d'activer le mode développeur.
2. Dans Premiere : **Paramètres → Plugins → Activer le mode développeur**, puis redémarrez.
3. Dans UXP Developer Tools : **Add Plugin**, choisissez `uxp/manifest.json`, puis **Load**.
4. Dans Premiere : **Fenêtre → UXP Plugins → Onde**.

## Modifier le panneau

```bash
npm run premiere
```

Cette commande reconstruit `cep/main.js` et `uxp/main.js` à partir de `src/`.
