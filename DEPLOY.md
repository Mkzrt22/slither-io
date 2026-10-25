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

## 4. Arène avec de l'argent réel (wallets crypto)

> ⚠️ Héberger le jeu hors de France ne supprime pas les obligations : les mises en ligne sont réglementées dans la plupart des pays (licence de jeu, vérification d'identité, lutte anti-blanchiment), y compris pour les joueurs qui s'y connectent. Choisis ta juridiction avec un avocat et bloque les pays où ce n'est pas autorisé (`BLOCKED_COUNTRIES`, avec Cloudflare devant le serveur).

### Comment ça marche
- **Connexion** : le joueur clique sur Phantom (Solana), MetaMask (Ethereum et BNB Chain) ou TronLink (TRON) et signe un message (gratuit, aucune transaction). Son adresse devient son compte. Un compte pseudo + mot de passe peut aussi lier un wallet.
- **Dépôt** : le serveur prépare la transaction, le wallet du joueur la signe et l'envoie vers l'adresse de la maison. Le serveur vérifie sur la blockchain (bon expéditeur, bon destinataire, bon jeton, assez de confirmations) puis crédite le solde **en dollars au cours du moment** (CoinGecko, Coinbase en secours ; les stablecoins valent 1 $). Une même transaction ne peut être utilisée qu'une fois.
- **Retrait** : toujours vers le wallet lié du joueur. Jusqu'à `AUTO_WITHDRAW_MAX_USD` (100 $ par défaut, et `AUTO_WITHDRAW_DAILY_USD` par 24 h), le serveur envoie tout seul depuis le wallet chaud ; au-delà, la demande attend ta validation dans `/admin.html` (bouton « Envoyer »). Si un envoi automatique échoue, il passe « À vérifier » et n'est **jamais** renvoyé ou remboursé automatiquement : tu regardes l'explorateur, puis « Marquer envoyé » ou « Refuser » (remboursement).
- **Changement de wallet** : un compte ne peut lier qu'un wallet par réseau et ne peut pas le changer seul (protection contre le vol de compte). Tu peux le délier depuis l'admin.

### Cryptos prises en charge

| Actif | Réseau | Remarque |
|---|---|---|
| SOL, USDC | Solana | USDC officiel de Circle |
| ETH, USDC | Ethereum | frais de réseau élevés : dépôt minimum conseillé 20 $ |
| BNB, USDC | BNB Chain | l'USDC y est émis par Binance (Binance-Peg, 18 décimales) |
| TRX, USDT | TRON | Circle n'émet plus d'USDC sur TRON : c'est l'USDT qui le remplace |

`CRYPTO_ASSETS` permet de n'en garder qu'une partie.

### Mise en place
1. **Teste d'abord sur les réseaux de test** : `CRYPTO_NETWORK=testnet` (Solana devnet, Sepolia, BNB testnet, TRON Nile). Des robinets gratuits donnent des jetons de test (faucet Solana, faucet Circle pour l'USDC de test, etc.).
2. Génère les wallets chauds de la maison sur une machine sûre :
   ```bash
   node scripts/new-wallets.js
   ```
   Copie les trois clés dans les variables de ton hébergeur (`SOLANA_HOT_WALLET_SECRET`, `EVM_HOT_WALLET_KEY`, `TRON_HOT_WALLET_KEY`) et garde une copie hors ligne. Sans clé (seulement `*_HOUSE_ADDRESS`), les dépôts marchent mais chaque retrait est à envoyer à la main.
3. Alimente les wallets chauds : un peu de SOL, d'ETH, de BNB et de TRX pour les frais réseau, plus de quoi payer les retraits automatiques. **Garde-y le minimum** et transfère le surplus vers un wallet froid : une clé sur un serveur peut être volée.
4. Prends des RPC fiables pour la production (les RPC publics sont limités) : Helius ou QuickNode pour Solana, Alchemy ou Infura pour Ethereum, NodeReal pour BNB Chain, TronGrid (`TRON_API_KEY`).
5. Variables à ajouter :
   ```
   PAYMENTS_MODE=crypto
   ARENA_REAL_MONEY=true
   CRYPTO_NETWORK=mainnet
   TOKEN_SECRET=...          # obligatoire
   ADMIN_TOKEN=...           # obligatoire
   SOLANA_HOT_WALLET_SECRET=...
   EVM_HOT_WALLET_KEY=...
   TRON_HOT_WALLET_KEY=...
   ```
   S'il manque quelque chose, le serveur reste en mode démo et l'écrit dans les logs. Au démarrage il affiche les actifs activés, par exemple : `payments: crypto · mainnet: SOL, USDC_SOL, ETH, …`.

### Réglages utiles
- `PRICE_SPREAD_BPS` (0,5 % par défaut) : marge appliquée aux cryptos volatiles, au dépôt comme au retrait.
- `WITHDRAW_FEES` : frais facturés au joueur par réseau (couvrent le gas que paie la maison).
- `HOUSE_FEE_BPS` : commission sur chaque entrée d'arène.
- `MIN_DEPOSIT`, `MAX_DEPOSIT`, `MIN_WITHDRAWAL` : en dollars.

### Ce qui n'est pas inclus
- Vérification d'identité (KYC) : à brancher selon ta licence (Sumsub, Veriff…).
- WalletConnect : sur mobile, les joueurs ouvrent le jeu dans le navigateur intégré de Phantom ou MetaMask (le jeu propose le lien automatiquement).

Les conditions (`public/legal.html`) sont un **modèle** : complète les passages surlignés et fais-les relire.

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
