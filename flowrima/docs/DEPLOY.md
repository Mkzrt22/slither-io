# Mettre Flowrima en ligne — guide pas à pas (débutant)

Compte 2 à 3 heures la première fois. Tu n'as besoin d'aucune compétence
serveur : tout se fait dans des interfaces web, plus quelques commandes à
copier-coller dans un terminal.

**Ordre recommandé** : 1. Supabase → 2. Anthropic → 3. Resend → 4. Vercel
(premier déploiement) → 5. Stripe → 6. Inngest → 7. PostHog et Sentry →
8. Vérifications finales. Commence tout en **mode test** (Stripe test, petit
budget Anthropic) et passe en production à la fin.

Garde un fichier texte ouvert (dans un gestionnaire de mots de passe idéalement)
pour noter les clés au fur et à mesure. **Ne colle jamais une clé secrète dans
un e-mail, un ticket ou un dépôt Git.**

---

## 0. Préparer ta machine

1. Installe **Node.js 22 LTS** : https://nodejs.org (bouton « LTS »).
2. Installe **Git** : https://git-scm.com.
3. Ouvre un terminal (macOS : app Terminal ; Windows : PowerShell) et vérifie :
   ```bash
   node -v   # doit afficher v22.x (v20.12 minimum)
   git --version
   ```
4. Récupère le code et installe les dépendances :
   ```bash
   git clone https://github.com/mkzrt22/slither-io.git
   cd slither-io/flowrima
   npm install
   ```

## 1. Supabase (base de données, comptes, fichiers) — région UE

1. Crée un compte sur https://supabase.com → **New project**.
   - *Name* : `flowrima` · *Database password* : génère-le et **note-le**.
   - *Region* : **West EU (Paris)** `eu-west-3` (ou Frankfurt). C'est
     important pour le RGPD : les données restent dans l'UE.
   - Plan : *Free* pour tester, **Pro (25 $/mois)** avant d'ouvrir au public
     (sauvegardes quotidiennes, pas de mise en pause).
2. Une fois le projet prêt : **Project Settings → API**. Note :
   - *Project URL* → `NEXT_PUBLIC_SUPABASE_URL`
   - *anon public* → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - *service_role* (clic sur « Reveal ») → `SUPABASE_SERVICE_ROLE_KEY`
     ⚠️ cette clé contourne toute la sécurité : serveur uniquement.
   - *Project ref* (l'identifiant dans l'URL, ex. `abcd1234`) : pour l'étape 3.
3. Applique le schéma (tables, sécurité RLS, fonctions, plans) depuis ton
   terminal, dans `flowrima/` :
   ```bash
   npx supabase login                         # ouvre le navigateur
   npx supabase link --project-ref abcd1234   # remplace par ton ref ; demande le mot de passe DB
   npx supabase db push                       # applique supabase/migrations/*
   ```
   Vérifie dans **Table Editor** que les tables `profiles`, `tracks`,
   `projects`, `plans`… existent, et que `plans` contient 4 lignes.
4. **Authentication → URL Configuration** :
   - *Site URL* : `https://flowrima.app` (ton domaine ; en attendant, l'URL
     Vercel de l'étape 4, ex. `https://flowrima.vercel.app`).
   - *Redirect URLs* : ajoute `https://flowrima.app/**` et
     `https://*-ton-equipe.vercel.app/**` (aperçus Vercel), plus
     `http://localhost:3000/**` pour le développement.
5. **Authentication → Providers** :
   - *Email* : activé, « Confirm email » **activé**.
   - *Google* (recommandé) : suis le lien « Google » de la page, crée un
     identifiant OAuth dans Google Cloud Console (type *Web*), avec comme
     *Authorized redirect URI* l'URL de callback affichée par Supabase. Colle
     *Client ID* et *Client secret* dans Supabase.
   - *Apple* : nécessite un compte Apple Developer (99 $/an). Facultatif au
     lancement.
   - Les boutons affichés sur les pages de connexion suivent la variable
     `NEXT_PUBLIC_AUTH_PROVIDERS` (ex. `google` ou `google,apple`) : n'y mets
     que les fournisseurs réellement configurés ici.
6. **Authentication → Emails → SMTP Settings** : branche Resend (étape 3)
   pour que les e-mails de confirmation partent de ton domaine
   (host `smtp.resend.com`, port `465`, user `resend`, mot de passe = clé API
   Resend). Sans ça, Supabase limite l'envoi à quelques e-mails par heure.
7. **Storage** : les buckets privés `audio`, `avatars`, `exports`, `beats` ont
   été créés par la migration 005. Vérifie qu'ils sont bien marqués *Private*.
8. **Database → Backups** (plan Pro) : vérifie que les sauvegardes
   quotidiennes sont actives. Active *Point in Time Recovery* plus tard si besoin.

## 2. Anthropic (IA)

1. https://console.anthropic.com → crée l'organisation → **Billing** : ajoute
   un moyen de paiement et un crédit de départ (20–50 $ suffisent pour tester).
2. **Settings → Limits** : fixe une **limite de dépense mensuelle** (ex. 100 $)
   et une alerte e-mail à 50 %. C'est ton filet de sécurité.
3. **API Keys → Create Key** (nom : `flowrima-prod`) → `ANTHROPIC_API_KEY`.
4. Dans tes variables : `LLM_PROVIDER=anthropic`,
   `ANTHROPIC_MODEL=claude-opus-5-5`. Les prix par million de tokens
   (`LLM_PRICE_*`) servent au calcul du coût réel affiché dans l'admin :
   revérifie-les sur la page tarifs d'Anthropic.
5. Accord de traitement des données (DPA) : il est intégré aux conditions
   commerciales d'Anthropic ; télécharge-le depuis la console (*Legal*) pour ton
   registre RGPD.

## 3. Resend (e-mails)

1. https://resend.com → **Domains → Add domain** : `flowrima.app`
   (région *EU* si proposée). Ajoute chez ton registrar les enregistrements DNS
   affichés (SPF, DKIM, éventuellement DMARC) et attends le statut *Verified*.
2. **API Keys → Create** (permission *Sending access*) → `RESEND_API_KEY`.
3. `EMAIL_FROM="Flowrima <bonjour@flowrima.app>"`.
4. Retourne à l'étape 1.6 pour brancher le SMTP de Supabase sur Resend.

## 4. Vercel (hébergement) — premier déploiement

1. Pousse le code sur ton GitHub (c'est déjà le cas si tu as cloné ce dépôt et
   que tu en es propriétaire).
2. https://vercel.com → **Add New → Project** → importe le dépôt.
3. **Root Directory : `flowrima`** (indispensable : l'app est dans ce
   sous-dossier). *Framework* : Next.js (détecté automatiquement).
4. **Environment Variables** : ouvre `.env.example`, et pour chaque ligne
   renseigne la valeur (Production + Preview). Au minimum pour démarrer :
   `NEXT_PUBLIC_SITE_URL`, les 3 variables Supabase, `ANTHROPIC_API_KEY`,
   `LLM_PROVIDER`, `ANTHROPIC_MODEL`, `RESEND_API_KEY`, `EMAIL_FROM`,
   `ADMIN_EMAILS` (ton e-mail), `NEXT_PUBLIC_AUTH_PROVIDERS`. Stripe,
   Inngest, PostHog et Sentry viendront aux étapes suivantes (l'app
   fonctionne sans : le bouton d'abonnement répond « Le paiement n'est pas
   encore configuré »).
5. **Deploy**. Au bout de 2–3 minutes tu obtiens une URL
   `https://flowrima-xxx.vercel.app`.
6. **Settings → Functions → Region** : vérifie *Paris (cdg1)* (le fichier
   `vercel.json` le demande déjà). Base et serveur dans la même ville = plus
   rapide.
7. **Settings → Domains** : ajoute `flowrima.app` et suis les instructions DNS.
   Mets ensuite à jour `NEXT_PUBLIC_SITE_URL` et la *Site URL* Supabase
   (étape 1.4), puis **Redeploy**.
8. Plan Vercel : *Hobby* est interdit pour un usage commercial → passe en
   **Pro (20 $/mois)** avant d'encaisser le moindre euro. Le Pro permet aussi
   les fonctions longues (génération en streaming jusqu'à 300 s).

## 5. Stripe (paiements)

Reste en **mode test** (interrupteur en haut à droite) jusqu'à la fin.

1. https://dashboard.stripe.com → active ton compte (infos société, IBAN).
2. **Product catalog → Add product** :
   - Nom : `Flowrima Artiste`. Prix 1 : **12,99 € / mois**, récurrent,
     *Tax behavior* : **Inclusive** (prix TTC affiché). Prix 2 : **119,88 € /
     an** (= 9,99 €/mois), récurrent, inclusive.
   - Copie les identifiants `price_...` → `STRIPE_PRICE_ARTIST_MONTHLY` et
     `STRIPE_PRICE_ARTIST_YEARLY`.
   - (Phase 2) Produits Pro, Label, packs de crédits : à créer plus tard.
3. **Settings → Tax** : active **Stripe Tax**, ajoute ton enregistrement TVA
   France (et le guichet OSS si tu vends dans d'autres pays de l'UE). Le
   Checkout calcule la TVA automatiquement (`automatic_tax`).
4. **Settings → Billing → Customer portal** : active l'annulation, le
   changement de moyen de paiement, l'historique des factures. Enregistre.
5. **Settings → Billing → Subscriptions and emails** :
   - *Manage failed payments* (relances) : active les **Smart Retries**
     (4 tentatives sur 2 semaines) puis « annuler l'abonnement ».
   - Active les e-mails Stripe de carte expirée / paiement échoué. Flowrima
     envoie en plus son propre e-mail de relance (webhook `invoice.payment_failed`).
6. **Developers → API keys** : `STRIPE_SECRET_KEY` (sk_test_…) et
   `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` (pk_test_…).
7. **Developers → Webhooks → Add endpoint** :
   - URL : `https://flowrima.app/api/stripe/webhook`
   - Événements : `checkout.session.completed`,
     `customer.subscription.created`, `customer.subscription.updated`,
     `customer.subscription.deleted`, `customer.subscription.trial_will_end`,
     `invoice.paid`, `invoice.payment_failed`.
   - Copie le *Signing secret* (`whsec_…`) → `STRIPE_WEBHOOK_SECRET`.
8. Ajoute ces variables dans Vercel, **Redeploy**.
9. Teste : crée un compte sur ton site, va sur **Tarifs → Essayer Artiste**,
   paie avec la carte de test `4242 4242 4242 4242` (date future, CVC
   quelconque). Tu dois revenir sur l'app en plan Artiste (essai de 7 jours)
   en quelques secondes. Dans Stripe → Webhooks, les événements doivent être
   en *Succeeded*.
10. **Passage en production** : bascule Stripe en mode live, refais les étapes
    2, 6 et 7 en live (les identifiants changent), mets à jour Vercel.

> Stripe Connect (paiement des beatmakers) n'est utilisé qu'en phase 3.

## 6. Inngest (file de jobs : analyses ADN)

Sans Inngest, l'analyse tourne en tâche de fond dans la fonction Vercel :
suffisant pour démarrer, mais une analyse longue peut être coupée. Avec
Inngest, chaque étape est rejouée automatiquement en cas d'erreur.

1. https://www.inngest.com → crée un compte.
2. Le plus simple : **Vercel Marketplace → Inngest → Add integration** et
   choisis ton projet : les variables `INNGEST_EVENT_KEY` et
   `INNGEST_SIGNING_KEY` sont ajoutées toutes seules.
   Sinon : *Manage → Event keys* et *Signing key*, à copier dans Vercel.
3. **Redeploy**, puis dans Inngest → *Apps → Sync new app* avec l'URL
   `https://flowrima.app/api/inngest`. La fonction `dna-analysis` doit
   apparaître.

## 7. PostHog (analytics) et Sentry (erreurs)

**PostHog** (chargé uniquement si l'utilisateur accepte les cookies) :
1. https://eu.posthog.com (**région EU**) → nouveau projet.
2. *Project settings* → *Project API key* → `NEXT_PUBLIC_POSTHOG_KEY` ;
   `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com`.

**Sentry** :
1. https://sentry.io → région de données **EU** à la création de
   l'organisation → nouveau projet *Next.js*.
2. *Client Keys (DSN)* → `NEXT_PUBLIC_SENTRY_DSN` et `SENTRY_DSN` (même valeur).
3. La configuration n'envoie ni IP, ni cookies, ni corps de requête, ni
   prompts/réponses IA (`src/instrumentation*.ts`).

**Redeploy** après avoir ajouté ces variables.

## 8. Devenir administrateur

Deux possibilités (cumulables) :
- ton e-mail dans `ADMIN_EMAILS` (variable Vercel) ;
- ou, dans Supabase → **SQL Editor** :
  ```sql
  update public.profiles set role = 'admin' where email = 'toi@exemple.fr';
  ```
Le back-office est sur `/app/admin` : métriques (MRR, churn, coût IA par
utilisateur et par fonctionnalité, activation), modération, utilisateurs,
**quotas des plans modifiables sans redéployer**.

## 9. Vérifications avant d'ouvrir au public

- [ ] Inscription par e-mail : l'e-mail de confirmation arrive (expéditeur
      ton domaine), le lien ramène sur l'onboarding.
- [ ] Connexion Google.
- [ ] Import de 3 titres → analyse ADN terminée en moins de 2 minutes.
- [ ] Génération : 3 propositions s'affichent en direct.
- [ ] Compte gratuit : la 4e génération du mois est bloquée avec l'offre Artiste.
- [ ] Paiement test → plan Artiste immédiatement, export PDF débloqué.
- [ ] Portail client Stripe accessible depuis **Compte**.
- [ ] Export de mes données (JSON) et suppression du compte fonctionnent.
- [ ] Bandeau cookies : « Refuser » aussi simple qu'« Accepter ».
- [ ] Pages légales : remplace **tous** les `[À COMPLÉTER]` (raison sociale,
      SIRET, adresse, hébergeur, médiateur) dans `src/content/legal/`, et
      fais-les relire par un juriste (CGV, rétractation, IA Act, SACEM).
- [ ] Limite de dépense Anthropic active, alertes Vercel/Supabase actives.
- [ ] Stripe en mode **live**, webhook live configuré.

## 10. Mettre à jour l'app plus tard

- Code : chaque `git push` sur la branche principale redéploie Vercel ; chaque
  branche/PR a son URL d'aperçu.
- Base : ajoute un fichier dans `supabase/migrations/` puis
  `npx supabase db push`. Ne modifie jamais une migration déjà appliquée.
- En cas de souci : Vercel → *Deployments* → *Promote to Production* sur
  l'ancien déploiement (retour arrière instantané).
