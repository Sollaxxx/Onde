# Site web d'Onde

Page d'accueil, liste d'attente de la bêta, mentions légales et politique de confidentialité.
Hébergement gratuit sur **Cloudflare Pages** ; les inscriptions sont stockées dans **Cloudflare D1**.

```
site/
├── public/                 Fichiers mis en ligne tels quels
│   ├── index.html          Page d'accueil (démo de timeline, liste d'attente)
│   ├── mentions-legales.html
│   ├── confidentialite.html
│   ├── fonts/, js/         Polices et défilement hébergés sur le site (aucun service tiers)
│   └── og-image.png        Image affichée quand on partage le lien
├── functions/api/inscription.js   Enregistre une adresse dans la liste d'attente
└── schema.sql              Table de la liste d'attente
```

## Mise en ligne (une seule fois, environ 15 minutes)

### 1. Créer la base de la liste d'attente
1. Tableau de bord Cloudflare → **Storage & Databases → D1** → **Create database**, nom : `onde`.
2. Ouvrez la base → onglet **Console**, collez le contenu de `schema.sql`, puis **Execute**.

### 2. Créer le site
1. **Workers & Pages → Create → Pages → Connect to Git**, autorisez GitHub et choisissez le dépôt `onde`.
2. Réglages de compilation :
   - **Production branch** : `main`
   - **Framework preset** : None
   - **Build command** : laisser vide
   - **Root directory** : `site`
   - **Build output directory** : `public`
3. **Save and Deploy**. Le site est en ligne à une adresse du type `onde-xxx.pages.dev`.

### 3. Brancher la liste d'attente
1. Dans le projet Pages → **Settings → Bindings → Add → D1 database**.
2. **Variable name** : `DB` · **D1 database** : `onde`.
3. Onglet **Deployments** → sur le dernier déploiement, **Retry deployment** pour prendre en compte la base.

Tant que la base n'est pas branchée, le formulaire répond « La liste d'attente ouvre très bientôt ».

### 4. (Optionnel) Mesure d'audience sans cookie
Projet Pages → **Metrics → Web Analytics → Enable**.

### 5. (Plus tard) Nom de domaine
Projet Pages → **Custom domains → Set up a custom domain**.

## Onde Équipe : comptes et équipes

Les comptes servent à l'offre **Onde Équipe**, sur demande. Connexion sans mot de passe : un code à 6 chiffres arrive par e-mail, puis l'application garde une session de six mois. Les équipes sont créées depuis la page **/admin** (forfait, places, stockage, essai), puis leurs propriétaires invitent eux-mêmes leurs membres depuis Onde (Réglages, Compte).

Les tables se créent toutes seules dans la base D1 `onde` (déjà branchée sous le nom `DB`).

### Mise en route (une seule fois)

1. **Envoi des e-mails avec Resend** (gratuit jusqu'à 3 000 e-mails par mois)
   1. Créer un compte sur resend.com, puis **Domains → Add domain** : `ondesound.com`.
   2. Ajouter dans Cloudflare (DNS de ondesound.com) les enregistrements que Resend affiche, puis cliquer sur **Verify**.
   3. **API Keys → Create API key** (droit « Sending access » suffit).
2. **Variables du projet Pages** (Settings → Variables and Secrets, en « Secret ») :
   - `RESEND_API_KEY` : la clé Resend ;
   - `ADMIN_MOT_DE_PASSE` : le mot de passe de la page /admin (différent de celui de la modération) ;
   - `EMAIL_EXPEDITEUR` (facultatif) : par défaut `Onde <compte@ondesound.com>`.
3. Redéployer le site. La page d'administration est sur **https://ondesound.com/admin/** (identifiant : n'importe quoi, mot de passe : `ADMIN_MOT_DE_PASSE`).

Ne jamais définir `ONDE_DEV` en production : cette variable sert seulement aux tests locaux (le code de connexion est alors renvoyé dans la réponse).

### Forfaits

| Forfait | Places | Stockage | Prix indicatif |
| --- | --- | --- | --- |
| Studio | 5 | 10 Go | 35 €/mois |
| Agence | 15 | 50 Go | 89 €/mois |
| Sur mesure | au choix | au choix | sur devis |

Places et stockage restent réglables équipe par équipe dans /admin. L'essai gratuit dure 30 jours par défaut ; passez l'équipe en « Actif » quand elle paie, ou en « Suspendu » pour la bloquer.

### Tester en local

```bash
node site/test-equipe.mjs
```

Pour essayer l'interface : `node site/serveur-local.mjs`, puis http://localhost:8787/admin/ (mot de passe « admin »). L'application lancée avec `npm run dev` dans un navigateur utilise ce serveur local pour les comptes.
