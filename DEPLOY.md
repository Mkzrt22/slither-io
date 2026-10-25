# 🚀 Déploiement et monétisation

## 1. Hébergement

### Railway (recommandé)
1. New Project → Deploy from GitHub → choisis le dépôt.
2. **Volume** : Settings → Volumes → Add volume, point de montage `/data`. Sans volume, la base (comptes, soldes, classements) est effacée à chaque déploiement.
3. Variables (Settings → Variables), au minimum :

```
NODE_ENV=production
PUBLIC_URL=https://ton-app.up.railway.app
DATA_DIR=/data
TOKEN_SECRET=<64 caractères hexadécimaux>
ADMIN_TOKEN=<autre secret long>
```

Génère un secret : `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`

Le healthcheck utilise `/health`.

### Render
`render.yaml` est fourni (disque persistant monté sur `/var/data`). Les disques demandent une offre payante (Starter) ; l'offre gratuite se met en veille et perd ses données.

### Une seule instance
Les salles vivent en mémoire : lance **une seule instance**. Pour monter en charge plus tard, il faudra des salles réparties par instance avec des sessions collantes (sticky sessions).

## 2. Publicité (AdSense)
1. Le fichier `public/ads.txt` contient déjà ton identifiant éditeur.
2. Dans AdSense → Annonces → Par bloc d'annonces, crée deux blocs (lobby et écran de mort) et renseigne `ADSENSE_SLOT_LOBBY` et `ADSENSE_SLOT_DEATH`. Sans ces variables, aucune publicité n'est chargée.
3. **Europe (RGPD)** : active le message de consentement de Google (AdSense → Confidentialité et messages → RGPD). C'est obligatoire pour diffuser des annonces aux visiteurs européens.

## 3. Pack Supporter (Stripe)
1. Crée un produit « NeonSlither Supporter Pack », prix unique (3 $ ou 3 €), et copie le Price ID dans `STRIPE_PRICE_ID`.
2. `STRIPE_SECRET_KEY` : clé secrète (sk_test_… pour les essais).
3. Webhook : `https://ton-domaine/api/stripe-webhook`, événement `checkout.session.completed`, secret dans `STRIPE_WEBHOOK_SECRET`.
4. Si l'acheteur est connecté, l'achat est lié à son compte (il le retrouve sur tous ses appareils).

## 4. Arène avec de l'argent réel

> ⚠️ **À lire avant d'activer quoi que ce soit.** En France, un jeu en ligne où l'on mise de l'argent pour en gagner relève en principe de la réglementation des jeux d'argent (Autorité nationale des jeux, ANJ) ; le fait de conserver les fonds des joueurs en crypto relève du statut de prestataire de services sur crypto-actifs (règlement MiCA, enregistrement AMF). Il faut aussi des vérifications d'identité (KYC), une politique anti-blanchiment et le blocage des pays où c'est interdit. **Fais valider le projet par un avocat spécialisé avant d'activer l'argent réel.** En attendant, le mode démo permet de tester et de faire connaître le jeu sans risque.

Une fois le cadre réglé :

1. Crée un compte marchand sur https://nowpayments.io, puis une clé API et un secret IPN (Store Settings).
2. Teste d'abord en bac à sable : `NOWPAYMENTS_SANDBOX=true` avec des clés sandbox.
3. Variables :

```
PAYMENTS_MODE=nowpayments
ARENA_REAL_MONEY=true
NOWPAYMENTS_API_KEY=...
NOWPAYMENTS_IPN_SECRET=...
NOWPAYMENTS_SANDBOX=false
TOKEN_SECRET=...      # obligatoire
ADMIN_TOKEN=...       # obligatoire
```

Si une de ces variables manque, le serveur reste en mode démo et l'indique dans les logs.

**Fonctionnement :**
- **Dépôt** : le joueur choisit un montant, il est redirigé vers une facture NOWPayments (il paie avec la crypto de son choix). Quand NOWPayments notifie `finished` sur `/api/payments/nowpayments/ipn` (signature HMAC-SHA512 vérifiée), le solde est crédité en USD. Les paiements partiels ou dont le montant ne correspond pas passent en statut `review` et se règlent à la main avec un ajustement.
- **Retrait** : le joueur indique montant, réseau et adresse ; le montant est bloqué tout de suite. Tu l'envoies depuis ton portefeuille ou le tableau de bord NOWPayments, puis tu le marques « Envoyé » avec le txid dans `/admin.html`. « Refuser » rembourse le joueur.
- **Commission** : `HOUSE_FEE_BPS` (500 = 5 %) prélevé à chaque départ de partie, visible dans l'admin (« Caisse maison »).
- **Auto-exclusion** : les joueurs peuvent se bloquer 24 h, 7 j, 30 j ou 6 mois depuis Portefeuille → Limites.

Les conditions (`public/legal.html`) sont un **modèle** : complète les passages surlignés (identité de l'éditeur, hébergeur, contact, durées) et fais-les relire.

## 5. Sécurité
- `TOKEN_SECRET` et `ADMIN_TOKEN` ne doivent jamais être commités (`.env` est ignoré par git).
- Changer `TOKEN_SECRET` déconnecte tout le monde et invalide les jetons Supporter stockés dans les navigateurs (les achats liés à un compte restent).
- Toutes les entrées des clients sont validées côté serveur (direction, skins, pseudos, chat) et limitées en fréquence ; les mots de passe sont hachés avec bcrypt.
- Sauvegarde régulièrement le fichier `data.db` du volume.

## 6. Trouver des joueurs
- Reddit : r/WebGames, r/IOGames, r/incremental_games, avec un GIF.
- itch.io (jeu HTML5 gratuit) et CrazyGames / Poki (portails de jeux web).
- TikTok / YouTube Shorts : les ralentis de mort et les gros kills en arène se partagent bien.
- Lien d'invitation intégré (bouton 🔗 en jeu) pour jouer entre amis.
