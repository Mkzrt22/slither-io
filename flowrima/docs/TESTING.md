# Tests

Trois niveaux, du plus rapide au plus complet. Tous tournent **sans clé
Anthropic ni Stripe réelle** (IA simulée, webhook signé avec un secret local).

| Niveau | Commande | Durée | Ce qui est vérifié |
|---|---|---|---|
| Unitaires | `npm test` | ~2 s | Moteur texte et IA (99 tests) |
| Base de données | `npm run test:db` ou `npx supabase test db` | ~10 s | Schéma, RLS, quotas, crédits (54 tests pgTAP) |
| Bout en bout | `npm run test:e2e` | ~1 min | Parcours réel dans Chromium à 375 px (29 tests) |

Plus `npm run typecheck` (TypeScript strict) et `npm run lint` (ESLint +
règles React Compiler).

## 1. Tests unitaires (Vitest) — `tests/unit/`

- `syllables.test.ts` : comptage français parlé/rap (e muet, élisions,
  nombres écrits en lettres, ad-libs mis à part), fourchette min/max
  (« p'tit », « sam'di »), jetons normalisés.
- `rhymes.test.ts` : rime pauvre / suffisante / riche, assonance, schémas
  AABB / ABAB, rimes multisyllabiques, rimes internes (sans les mots-outils
  comme « j'ai »).
- `recycling.test.ts` : index du catalogue, détection de toute séquence de
  **5 mots consécutifs** ou plus (normalisée : accents, ponctuation,
  majuscules), quasi-doublons.
- `originality.test.ts` : **critère d'acceptation « jamais plus de 4 mots
  consécutifs du catalogue »** : on force le fournisseur IA à recopier des
  lignes du catalogue et on vérifie que `enforceOriginality` les remplace
  toujours (y compris quand la régénération échoue).
- `analyze.test.ts` : statistiques ADN, score de fiabilité, extraits de
  référence déterministes.
- `ai.test.ts` : schémas de sortie, échappement des paroles (données jamais
  interprétées comme instructions), calcul de coût (cache, batch), marge.
- `misc.test.ts` : part réécrite par l'artiste, rendu (ad-libs, respirations,
  rimes), liens plateformes (API officielles, anti-SSRF, Genius refusé),
  dictionnaire de rimes hors ligne, validation des requêtes du studio.

## 2. Base de données (pgTAP) — `supabase/tests/`

`rls.test.sql` (49 tests) crée deux artistes, Alice et Bob, et vérifie :
- isolation complète : Bob ne voit, ne modifie ni ne supprime rien d'Alice
  (titres, ADN, projets, versions, générations, crédits, consentements…) ;
- colonnes protégées : un utilisateur ne peut pas changer son plan, son rôle,
  son statut de vérification ni ses compteurs ;
- **quotas** : la 4e génération gratuite du mois est refusée, un abonnement
  actif débloque immédiatement, remboursement en cas d'échec ;
- crédits : idempotence (même événement Stripe rejoué = pas de double crédit),
  expiration des crédits mensuels ;
- lien de partage : lisible seulement avec le jeton, version courante d'un
  autre utilisateur impossible à rattacher.

`admin.test.sql` (5 tests) : métriques justes (MRR, coût IA) et réservées au serveur.

Deux façons de les lancer :
- **avec Docker** : `npx supabase start` puis `npx supabase test db` ;
- **sans Docker** : `npm run test:db` (Postgres 16 + pgvector + pgTAP
  installés localement, ex. `apt install postgresql-16
  postgresql-16-pgvector postgresql-16-pgtap`). Le script crée une base
  jetable, simule les rôles Supabase (`scripts/db/supabase_stub.sql`),
  applique les migrations et lance les tests.

## 3. Bout en bout (Playwright) — `tests/e2e/`

Prérequis :
```bash
npx supabase start && npx supabase db reset
# .env.local : URL + clés du Supabase local, et
#   LLM_PROVIDER=mock
#   MOCK_LLM_DELAY_MS=5
#   STRIPE_SECRET_KEY=sk_test_local_dummy
#   STRIPE_WEBHOOK_SECRET=whsec_local_e2e_secret
#   STRIPE_PRICE_ARTIST_MONTHLY=price_test_artist_monthly
#   STRIPE_PRICE_ARTIST_YEARLY=price_test_artist_yearly
npm run build && npm start         # dans un autre terminal
npx playwright install chromium     # une seule fois
npm run test:e2e
```
(`PW_CHROMIUM_PATH=/chemin/vers/chromium` pour réutiliser un Chromium
existant ; `BASE_URL` pour viser un autre serveur.)

`marketing.spec.ts` (375 px et bureau) : pages publiques, **aucun défilement
horizontal à 375 px**, liste d'attente, bandeau cookies, pages légales,
`/app` protégé, API refusant les requêtes anonymes.

`flow.spec.ts` (375 px), le parcours complet d'un artiste :
1. inscription (consentements enregistrés) → onboarding → profil artiste ;
2. import de 3 titres avec attestation de droits ;
3. analyse ADN des 3 titres, avec les visuels ;
4. génération : **3 propositions** étiquetées, syllabes et rimes visibles ;
5. édition d'une ligne (boutons de retouche proposés) et sauvegarde
   automatique ;
6. export TXT (avec la mention « Généré avec l'IA »), PDF refusé en gratuit
   avec l'offre Artiste ;
7. **4e génération du mois bloquée** proprement avec l'offre Artiste ;
8. webhook Stripe **signé** → plan Artiste immédiatement, une nouvelle
   génération passe ; webhook à signature falsifiée → refusé (400) ;
9. **avec 5 titres importés** (plan Artiste), ADN mis à jour **en moins de
   2 minutes** et affiché (version 2, radar) ;
10. pages de l'app sans défilement horizontal à 375 px, export RGPD (JSON) ;
11. un second utilisateur reçoit « Page introuvable » sur le projet et 404 sur
    l'export du premier, puis supprime son propre compte.

## Ce qui n'est pas (encore) testé automatiquement

- Appels réels à l'API Anthropic (coût, non-déterminisme) : à vérifier à la
  main en préproduction avec une vraie clé (voir `docs/DEPLOY.md` §9). Le
  fournisseur réel partage tous ses traitements (validation zod, refus,
  remboursement, anti-recyclage) avec le fournisseur simulé, seule la couche
  d'appel diffère.
- Paiement Stripe réel (Checkout hébergé par Stripe) : carte de test en
  préproduction.
- Connexion Google/Apple (dépend des consoles des fournisseurs).
