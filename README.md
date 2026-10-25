# 🐍 NeonSlither

Jeu de serpent multijoueur néon en temps réel (Node.js, Socket.io, Canvas), avec une **arène à mise** où tout le monde part à égalité.

## Démarrage rapide

```bash
npm install
npm start          # http://localhost:3000
npm run dev        # rechargement automatique (nodemon)
npm test           # tests (node:test)
```

Pour tester le multijoueur, ouvre plusieurs onglets ou partage `http://TON_IP:3000` sur le réseau local.

## Modes de jeu

| Mode | Principe |
|---|---|
| **Classique** | Partie libre sans fin avec des bots, réapparition à volonté. Bouton **JOUER** = salle publique de la carte choisie. |
| **Score** | Premier à 200 : la manche se termine puis recommence. |
| **Équipes** | Rouges contre bleus, première équipe à 600. |
| **Royale** | Départ commun, pas de réapparition, la zone rétrécit, dernier serpent en vie. |
| **Classé (Elo)** | Royale entre vrais joueurs connectés ; l'Elo est enregistré sur le compte. |
| **Arène à mise** | Entrée payante par palier, départ simultané à taille égale, la valeur des serpents éliminés revient au tueur, encaissement à tout moment. |

### L'arène à mise

1. Le joueur choisit un palier (par défaut 0,25 / 1 / 5 / 20) et paie l'entrée depuis son solde.
2. Dès qu'il y a assez de joueurs (2 à 10), un compte à rebours démarre ; tout le monde apparaît **au même moment, avec la même longueur, à égale distance du centre**. Pas de bots, pas de bonus aléatoires, pas de capacités de niveau.
3. La maison prélève `HOUSE_FEE_BPS` (5 % par défaut) ; le reste est la **valeur** du joueur.
4. Éliminer un serpent transfère **toute sa valeur** au tueur. Un serpent qui meurt seul (zone, mur, lui-même) lâche sa valeur en pièces d'or que tout le monde peut manger.
5. **Maintenir C (3 s)** encaisse la valeur et quitte la partie.
6. La partie s'arrête quand il reste un serpent ou au bout du temps imparti ; les survivants sont payés.

Chaque mouvement d'argent est écrit dans un registre SQLite (`ledger`) au moment où il se produit. En cas d'arrêt propre (SIGTERM) ou de crash, les parties sont soldées au redémarrage et les files d'attente remboursées. Les tests vérifient qu'aucun centime n'est créé ni perdu.

Par défaut l'arène utilise des **crédits démo** (aucune valeur). En mode réel, les joueurs se connectent avec **Phantom, MetaMask ou TronLink**, déposent et retirent **SOL, ETH, BNB, USDC, TRX ou USDT** depuis leur wallet ; le solde est tenu en dollars. Voir [DEPLOY.md](DEPLOY.md).

## Commandes

| Action | Souris / clavier | Mobile |
|---|---|---|
| Diriger | Souris, ou ← → / Q D | Joystick |
| Accélérer | Clic, Espace, ↑ | Bouton BOOST |
| Emotes | 1 à 9 | Boutons à droite |
| Chat | Entrée | — |
| Menu | Échap / P | ⏸ |
| Encaisser (arène) | Maintenir C | Maintenir ENCAISSER |

## Structure

```
server.js              point d'entrée (assemble les modules, arrêt propre)
shared/constants.js    constantes partagées serveur + navigateur
src/
  config.js            variables d'environnement
  db.js                SQLite + migrations
  auth.js              comptes, sessions signées
  stats.js             stats, succès, classements, Battle Pass, Elo
  sockets.js           événements Socket.io (validation, limites de débit)
  http.js              routes HTTP (Stripe, admin, santé)
  payments.js          dépôts/retraits (démo ou crypto), retraits auto sous plafond
  crypto/              connexion par wallet (signatures), adaptateurs Solana / EVM / TRON, cours en USD
  economy/ledger.js    registre des soldes
  economy/arena.js     files, parties à mise, règlement, reprise après crash
  game/room.js         simulation d'une salle (25 ticks/s), manches, envoi réseau par zone visible
  game/bots.js         IA des bots
  game/manager.js      salles publiques, boucle de jeu
public/
  index.html, css/, js/ client (rendu interpolé, HUD, lobby, arène, FR/EN)
  admin.html           administration (retraits, ajustements)
  legal.html           modèle de mentions légales / CGU / confidentialité / jeu responsable
scripts/new-wallets.js génère les wallets chauds de la maison
test/                  tests unitaires
```

## Réseau

Chaque joueur ne reçoit que ce qui est proche de lui (environ 1,5 Ko par paquet au lieu de 50 Ko), et le client interpole entre deux paquets pour un mouvement fluide à 60 i/s. La caméra dézoome quand le serpent grandit.
