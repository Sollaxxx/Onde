# Sauvegarde nocturne d'Onde sur un NAS (OpenMediaVault)

Chaque nuit, le NAS copie **tout Onde** chez vous et **remplace la copie de la veille** par la nouvelle :

| Dossier sur le NAS | Contenu |
|---|---|
| `sons/` | Tous les sons en ligne et le catalogue (bucket Cloudflare R2 `onde-sons`) |
| `base/onde.sql` | La base de données : liste d'attente, retours des testeurs, contributions (Cloudflare D1) |
| `code/onde.git` | Le dépôt GitHub complet, avec tout l'historique |
| `DERNIERE-SAUVEGARDE.txt` | Date, résultat et taille de la dernière sauvegarde |

Le NAS **va chercher** les données lui-même : aucun port n'est ouvert sur votre box, personne ne peut entrer chez vous.

**Garde-fou :** si la source semble soudain vide ou presque (panne, clé erronée, effacement accidentel en ligne), la copie miroir est **annulée** et la sauvegarde de la veille est gardée. Même chose pour la base : l'ancienne copie n'est remplacée que si le nouvel export a réussi.

---

## 1. Installer Docker sur OpenMediaVault (une seule fois)

1. Connectez-vous au NAS en SSH (`ssh admin@adresse-du-nas`) et installez **omv-extras** :
   ```bash
   wget -O - https://github.com/OpenMediaVault-Plugin-Developers/packages/raw/master/install | sudo bash
   ```
2. Dans l'interface web d'OMV : **Système → Extensions** (Plugins), installez **openmediavault-compose**.
3. **Services → Compose → Paramètres** : choisissez un dossier partagé pour Compose, puis cliquez sur **Réinstaller Docker** si Docker n'est pas encore installé.

## 2. Créer le dossier de sauvegarde

**Stockage → Dossiers partagés → Créer** : nommez-le `Onde`, sur le disque de votre choix.
Notez son **chemin absolu** (colonne « Chemin absolu », du type `/srv/dev-disk-by-uuid-…/Onde`).

## 3. Créer les deux clés Cloudflare

Elles servent uniquement à **lire** vos données. Ne les collez jamais dans une conversation ou un e-mail.

1. **Clé R2 (sons), en lecture seule**
   Cloudflare → **R2** → **Gérer les jetons d'API R2** → **Créer un jeton d'API**
   - Permissions : **Lecture d'objets uniquement** (Object Read only)
   - Bucket : `onde-sons` seulement
   - Notez l'**ID de clé d'accès** et la **clé d'accès secrète** (affichée une seule fois).
2. **Jeton pour la base D1**
   Cloudflare → photo de profil → **Mon profil** → **Jetons d'API** → **Créer un jeton** → **Créer un jeton personnalisé**
   - Permission : **Compte · D1 · Modifier** (l'export de la base l'exige ; le script ne fait que lire)
   - Ressources du compte : votre compte uniquement
3. **Identifiant du compte** : tableau de bord Cloudflare → menu `⋯` à côté du nom du compte → **Copier l'ID du compte**.

## 4. Installer la sauvegarde sur le NAS

En SSH :
```bash
sudo git clone https://github.com/Sollaxxx/Onde.git /srv/onde-code
```
```bash
cd /srv/onde-code/scripts/nas && sudo cp .env.exemple .env && sudo chmod 600 .env && sudo nano .env
```
Remplissez le fichier `.env` (chemin du dossier `Onde`, identifiant du compte, clés de l'étape 3), puis enregistrez (`Ctrl O`, `Entrée`, `Ctrl X`).

Construisez l'image puis lancez une première sauvegarde pour vérifier :
```bash
cd /srv/onde-code/scripts/nas && sudo docker compose build
```
```bash
cd /srv/onde-code/scripts/nas && sudo docker compose run --rm sauvegarde
```
La première fois, tous les sons sont téléchargés : cela peut prendre un moment. La dernière ligne doit indiquer `Résultat : OK`.

## 5. Programmer la sauvegarde chaque nuit

Interface web d'OMV → **Système → Tâches planifiées → Créer** :
- **Activé** : oui
- **Heure d'exécution** : Certain · minute `30` · heure `3` · tous les jours
- **Utilisateur** : `root`
- **Commande** :
  ```
  cd /srv/onde-code/scripts/nas && docker compose run --rm sauvegarde
  ```
- **Envoyer la sortie de la commande par e-mail** : oui (configurez d'abord **Système → Notifications** pour recevoir un e-mail si la sauvegarde échoue).

Pour tester tout de suite : sélectionnez la tâche et cliquez sur **Exécuter**.

## Mettre à jour la sauvegarde

Quand ce dossier change dans le dépôt :
```bash
cd /srv/onde-code && sudo git pull && cd scripts/nas && sudo docker compose build
```

## Restaurer

- **Sons** : renvoyer le dossier `sons/` dans un bucket R2 (`rclone sync sons r2:onde-sons`).
- **Base** : `wrangler d1 execute Onde --remote --file base/onde.sql` (sur une base vide).
- **Code** : `git clone code/onde.git`.

## À savoir

- C'est une **copie miroir** : un son effacé en ligne disparaît aussi du NAS la nuit suivante (sauf si presque tout disparaît d'un coup : le garde-fou bloque alors l'effacement). Pour garder des versions plus anciennes, utilisez un système de fichiers avec instantanés (Btrfs) ou une copie supplémentaire.
- **La clé de signature des mises à jour** (`onde.key`) n'est pas copiée automatiquement : copiez-la **vous-même une fois** dans un dossier du NAS, en plus de votre autre copie. Sans elle, plus aucune mise à jour d'Onde n'est possible.
- Le NAS seul ne protège pas d'un incendie ou d'un vol : idéalement, gardez une autre copie hors de chez vous (disque externe ailleurs, ou sauvegarde en ligne chiffrée).
- Le fichier `.env` contient vos clés : il reste sur le NAS et n'est jamais envoyé sur GitHub.
