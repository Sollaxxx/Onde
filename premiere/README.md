# Panneau Onde pour Premiere Pro

Un panneau dans Premiere Pro pour chercher, écouter et poser les sons d'Onde sans quitter le logiciel.

- **Insérer** : pose le son à la tête de lecture, sur la première piste audio libre (aucun clip existant n'est déplacé). Le son est rangé dans un chutier « Onde » du projet.
- **Glisser-déposer** (Premiere 27 et plus) : glissez une ligne vers la timeline ou le panneau Projet.
- Les sons sont enregistrés dans le même dossier que l'application Onde : un son déjà utilisé n'est jamais retéléchargé.

Premiere Pro **25.6 ou plus récent** est nécessaire.

## Essayer le panneau (mode développeur)

1. Installez **UXP Developer Tools** depuis l'application Creative Cloud (**Toutes les applications**). Au premier lancement, acceptez d'activer le **mode développeur**.
2. Dans Premiere : **Paramètres → Plugins → Activer le mode développeur**, puis redémarrez Premiere.
3. Dans UXP Developer Tools : **Add Plugin**, choisissez `premiere/plugin/manifest.json`, puis **Load** (Premiere doit être ouvert).
4. Dans Premiere : **Fenêtre → UXP Plugins → Onde**.

## Modifier le panneau

Le code est dans `premiere/src/panel.ts` ; il réutilise la recherche de l'application (`src/search.ts`).

```bash
npm run premiere
```

Cette commande produit `premiere/plugin/main.js`. Dans UXP Developer Tools, **Reload** recharge le panneau.
