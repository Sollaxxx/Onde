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

## Voir les inscrits
D1 → base `onde` → **Console** :

```sql
SELECT email, created_at FROM waitlist ORDER BY created_at DESC;
```

## Avant de partager le lien publiquement
- ✅ Adresse de contact branchée : contact.ondesound@gmail.com
- Brancher le lien Ko-fi, ou retirer le bloc « Soutenir ».
