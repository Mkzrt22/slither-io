# Flowrima — le studio d'écriture IA des artistes indépendants

Flowrima apprend le style d'un·e artiste à partir de son catalogue (son **ADN
artistique**) et l'aide à écrire des paroles **originales** qui sonnent comme
lui ou elle : trois propositions en direct, éditeur à la mesure avec syllabes
et rimes colorées, retouches ligne par ligne, exports, partage privé.

> Ce dossier contient l'application. Le reste du dépôt (racine) héberge un
> autre projet sans rapport : Flowrima est volontairement isolé dans
> `flowrima/` (voir `docs/DECISIONS.md`).

**État : phase 0 (landing + liste d'attente) et phase 1 (MVP) livrées.**
Le rapport de phase, ce qui marche, ce qui reste et la suite :
[`docs/PHASES.md`](docs/PHASES.md).

| Document | Pour quoi faire |
|---|---|
| [`docs/DEPLOY.md`](docs/DEPLOY.md) | Mettre en ligne pas à pas (pensé pour un débutant) |
| [`docs/TESTING.md`](docs/TESTING.md) | Lancer les tests (unitaires, base de données/RLS, bout en bout) |
| [`docs/COSTS.md`](docs/COSTS.md) | Coût par génération, coûts mensuels 100 / 1 000 / 10 000 utilisateurs, marge |
| [`docs/DECISIONS.md`](docs/DECISIONS.md) | Les choix faits sans te demander, et pourquoi |
| [`docs/PHASES.md`](docs/PHASES.md) | Rapport des phases 0 et 1, feuille de route phases 2 et 3 |

## Démarrer en local (10 minutes)

Prérequis : Node.js 20.12+ (22 recommandé), Docker (pour Supabase local).

```bash
cd flowrima
npm install
cp .env.example .env.local          # puis remplis-le (voir ci-dessous)
npx supabase start                  # Postgres + Auth + Storage + Realtime en local
npx supabase db reset               # applique supabase/migrations/*
npm run dev                         # http://localhost:3000
```

`npx supabase start` affiche l'URL de l'API et les clés `anon` / `service_role` :
copie-les dans `.env.local` (`NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`).

**Sans clé Anthropic**, mets `LLM_PROVIDER=mock` : l'IA est simulée
(réponses déterministes) pour développer gratuitement. Un bandeau « Mode démo »
le signale dans l'app. **Sans Inngest**, les analyses ADN tournent en tâche de
fond dans le serveur (`after()`), ce qui suffit en local.

Pour devenir admin en local : ajoute ton e-mail à `ADMIN_EMAILS`.

## Commandes

| Commande | Effet |
|---|---|
| `npm run dev` | Serveur de développement |
| `npm run build` / `npm start` | Build et serveur de production |
| `npm run typecheck` / `npm run lint` | TypeScript strict / ESLint |
| `npm test` | Tests unitaires (Vitest) : moteur de rimes, syllabes, anti-recyclage, IA simulée |
| `npm run test:db` | Tests pgTAP du schéma et de la RLS (Postgres jetable) |
| `npx supabase test db` | Les mêmes tests sur le Supabase local (Docker) |
| `npm run test:e2e` | Parcours complet dans Chromium à 375 px (Playwright) |
| `npm run inngest` | Serveur de dev Inngest (file de jobs) |

## Pile technique

Next.js 16 (App Router, Cache Components, `proxy.ts`) · TypeScript strict ·
Tailwind CSS v4 · composants façon shadcn/ui sur Radix · Supabase (Postgres UE,
Auth, Storage privé, Realtime, pgvector, RLS partout) · Inngest (jobs) ·
Anthropic `@anthropic-ai/sdk` (modèle `claude-opus-5-5`, derrière une interface
`LLMProvider`) · Stripe (Checkout, Billing, Tax, portail client) · Resend ·
PostHog UE (après consentement) · Sentry · Vercel (région Paris).

## Arborescence

```
flowrima/
├── .env.example                 # toutes les variables, commentées
├── next.config.ts               # Cache Components, en-têtes de sécurité, images
├── vercel.json                  # région cdg1 (Paris), proche de Supabase UE
├── supabase/
│   ├── config.toml              # Supabase local
│   ├── migrations/              # 001 types · 002 tables · 003 fonctions (quotas,
│   │                            # crédits, RGPD) · 004 RLS · 005 storage/realtime
│   │                            # · 006 plans · 007 métriques admin
│   └── tests/                   # pgTAP : isolation RLS, quotas, crédits, partage
├── scripts/                     # test-db.sh (pgTAP sans Docker), icônes PWA
├── src/
│   ├── proxy.ts                 # session Supabase + protection de /app
│   ├── instrumentation*.ts      # Sentry (sans données perso ni prompts)
│   ├── i18n/                    # fr.ts (source) · en.ts · index.ts
│   ├── app/
│   │   ├── (marketing)/         # landing + liste d'attente, tarifs, FAQ, blog, légal
│   │   ├── (auth)/              # connexion, inscription, mot de passe
│   │   ├── app/                 # espace connecté : tableau de bord, onboarding,
│   │   │                        # catalogue, adn, studio, projets, compte, prod,
│   │   │                        # beatmaker, admin
│   │   ├── s/[token]/           # lien privé de partage (lecture seule)
│   │   └── api/                 # génération (streaming NDJSON), retouches, rimes,
│   │                            # exports, webhook Stripe, Inngest, RGPD
│   ├── components/              # ui/ (design system) + un dossier par écran
│   └── lib/
│       ├── text/                # moteur local : phonétique FR, syllabes, rimes,
│       │                        # parse, stats, anti-recyclage, flow, rendu
│       ├── ai/                  # LLMProvider, Anthropic, mock, schémas, prompts 7.x
│       ├── services/            # ADN, studio (génération/retouches), quotas
│       ├── jobs/                # Inngest (analyse ADN, Batch API)
│       ├── actions/             # Server Actions (auth, catalogue, projets, billing…)
│       ├── billing/             # plans, Stripe, synchronisation des abonnements
│       ├── supabase/            # clients serveur / navigateur / admin / proxy
│       ├── platforms/           # métadonnées via API officielles (anti-SSRF)
│       └── export/              # PDF fiche studio
└── tests/
    ├── unit/                    # Vitest
    └── e2e/                     # Playwright (375 px)
```

## Principes non négociables (rappel)

- **Aucun secret côté client** : seules les variables `NEXT_PUBLIC_*` partent
  au navigateur ; la clé `service_role` n'est utilisée que dans le code serveur
  (`import "server-only"`).
- **RLS sur toutes les tables**, colonnes sensibles (plan, rôle, statuts)
  non modifiables par l'utilisateur, quotas comptés côté serveur de façon
  atomique (`consume_quota`).
- **Paroles importées = données**, jamais instructions (échappées et balisées
  dans les prompts) ; **anti-recyclage** : jamais plus de 4 mots consécutifs
  repris du catalogue, vérifié par le code après chaque génération.
- **Pas de scraping** (Genius, Musixmatch) ni de téléchargement YouTube/Spotify :
  l'artiste colle ses paroles ou envoie un fichier ; les liens ne servent qu'à
  récupérer des métadonnées via les API officielles.
- **Pas d'entraînement** sur les données des artistes sans opt-in explicite
  (désactivé par défaut, réglable dans Compte).
