# Rapport de phases

## Phases 0 et 1 — livrées (15 octobre 2026)

### Ce qui fonctionne

**Phase 0 — valider la demande**
- Landing : promesse, démo de paroles avec syllabes et rimes colorées,
  « comment ça marche », tarifs, FAQ, **liste d'attente** (anti-spam,
  consentement enregistré).
- Pages Tarifs, FAQ (données structurées pour Google), blog (3 articles),
  pages légales, bandeau cookies conforme CNIL, sitemap, robots, PWA
  installable avec page hors ligne.
- Kit des **10 entretiens** artistes : `docs/INTERVIEWS.md` (recrutement,
  script, grille, critères de passage en phase 2).

**Phase 1 — MVP**
- **Comptes** : e-mail + mot de passe (confirmation), lien magique, Google /
  Apple (configurables), mot de passe oublié ; consentements CGU et
  confidentialité horodatés.
- **Onboarding** en 3 étapes : profil artiste (nom de scène, genres,
  langues, contenu explicite), import, analyse.
- **Catalogue** : paroles collées ou fichier .txt / .docx, liens Spotify,
  Deezer, Apple Music, YouTube, SoundCloud (titre, pochette, date, durée via
  API officielles), **attestation de droits obligatoire**, minimum 3 titres
  et **score de fiabilité** de l'ADN. Limite par plan appliquée par la base.
- **ADN artistique** : mesures calculées par le code (syllabes par mesure,
  schémas de rimes, rimes multisyllabiques et internes, densité, richesse
  du vocabulaire, part d'anglais, structure, répétitions, ad-libs), puis
  interprétées par l'IA (prompt 7.1). Versionné. Progression en direct.
  Visuels : 5 points de signature, radar des thèmes, nuage de mots
  signatures, tuiles de chiffres, schémas dominants, évolution dans le temps
  (avec tableau de données), sujets inexplorés.
- **Studio d'écriture** : sujet ou « Inspire-moi », ambiance, curseur de
  fidélité, phrase clé, structure par parties et mesures, BPM et tonalité,
  langues, explicite, gimmick autorisé, référence de style → **3 propositions
  A / B / C en streaming**, balisées, avec débit, note de flow et « pourquoi
  ça sonne comme toi ».
- **Éditeur** : une ligne = une mesure, numéros de mesure, durée au BPM,
  syllabes en marge avec cible (couplets), rimes colorées par famille avec
  lettre, respirations « / », ad-libs ; **retouches en un clic** sur une
  ligne ou une section (régénérer, plus punchy, plus sombre, rimes plus
  riches, plus simple, double sens, caler sur le BPM, s'éloigner de mes
  textes) ; dictionnaire de rimes hors ligne nourri de ton vocabulaire,
  assistant IA ; annuler, sauvegarde automatique, historique des versions,
  part réécrite par l'artiste.
- **Garde-fous** : anti-recyclage (> 4 mots consécutifs) vérifié par le
  code, modération (thèmes durs autorisés, haine/harcèlement/mineurs
  refusés), signalement, paroles importées traitées comme des données.
- **Exports** : TXT (tous plans), fiche studio PDF (Artiste), lien privé de
  partage révocable ; mention « généré avec l'IA ».
- **Projets** : liste, statuts (idée → écriture → prêt à enregistrer → sorti), notes.
- **Paiement** : Découverte (gratuit) et Artiste (12,99 €/mois ou 9,99 €/mois
  en annuel), essai 7 jours, Stripe Checkout + TVA automatique + portail
  client, webhooks signés et idempotents, relances, **quotas côté serveur**,
  blocage propre avec offre d'abonnement, déblocage immédiat après paiement,
  compteur d'usage visible.
- **Compte et RGPD** : profil, mot de passe, opt-ins (entraînement désactivé
  par défaut), **export de mes données en un clic**, **suppression du
  compte en un clic** (abonnement Stripe résilié), registre des
  consentements.
- **Back-office** : MRR, churn, utilisateurs par plan, **coût IA réel** par
  fonctionnalité / utilisateur / plan, activation, erreurs, modération,
  utilisateurs (rôles, vérification), **quotas modifiables à chaud**,
  journal d'audit.

### Critères d'acceptation (§14) — vérifiés automatiquement

| Critère | Preuve |
|---|---|
| 5 titres → ADN en moins de 2 min, affiché visuellement | e2e `flow.spec.ts` étape 9 (IA simulée) |
| 3 versions complètes, balisées, syllabes et rimes visibles, en streaming | e2e étape 4 |
| Jamais plus de 4 mots consécutifs du catalogue | `tests/unit/originality.test.ts` + `recycling.test.ts` |
| Gratuit bloqué au 4e essai avec l'offre ; paiement → accès immédiat | e2e étapes 7–8 + pgTAP |
| Aucun accès aux données d'un autre utilisateur | 49 tests pgTAP RLS + e2e étape 11 |
| Utilisable à 375 px sans défilement horizontal | e2e sur les pages publiques et les principales pages de l'app |

Résultats au moment de la livraison : **99 tests unitaires, 54 tests
pgTAP, 29 tests e2e verts**, TypeScript strict et ESLint sans erreur, build
de production OK.

### Ce qui reste à faire avant d'ouvrir au public

1. **Premier essai avec une vraie clé Anthropic** (tout a été validé avec
   l'IA simulée, faute de clé dans cet environnement) : qualité des textes,
   tokens et coût réels, temps de l'ADN avec l'effort `high`. Ajuster les
   prompts sur 5–10 vrais catalogues (les entretiens de phase 0).
2. **Pages légales** : compléter les informations société et faire relire
   par un avocat (CGU, CGV, confidentialité, mentions IA Act et SACEM).
3. **Configurer les services** en suivant `docs/DEPLOY.md` (Stripe live,
   Tax, portail, Resend avec ton domaine, Google OAuth, Inngest).
4. **Décisions de prix/quotas** après mesure (voir `docs/COSTS.md` §3).
5. **CSP stricte** (Content-Security-Policy à nonce).
6. **Traduction anglaise** : le dictionnaire `en` existe, mais une partie
   des textes est encore écrite directement dans les composants ; à extraire
   avant d'ouvrir l'anglais.
7. Audit d'accessibilité avec lecteur d'écran (contrastes AA et navigation
   clavier sont déjà traités).
8. Personnaliser les e-mails d'authentification Supabase (logo, ton).

### Coûts mensuels estimés (détail et hypothèses : `docs/COSTS.md`)

| | 100 utilisateurs | 1 000 | 10 000 |
|---|---|---|---|
| Hébergement et services | ≈ 45 € | ≈ 80 € | ≈ 290 € |
| IA (Claude Opus 5.5) | ≈ 40 € | ≈ 400 € | ≈ 4 000 € |
| Frais Stripe | ≈ 2 € | ≈ 22 € | ≈ 218 € |
| **Total** | **≈ 87 €** | **≈ 500 €** | **≈ 4 500 €** |
| Revenu HT (6 % d'abonnés Artiste) | ≈ 60 € | ≈ 605 € | ≈ 6 045 € |

Marge sur les abonnés ≈ 61 % ; le gratuit pèse la moitié de la facture IA.

---

## Phase 2 — proposée, **pas commencée** (attend ton feu vert)

Contenu du cahier des charges : upload audio, transcription, analyse audio,
Studio Prod mode « Proposer » + espace beatmaker, plans Pro et Label.

Plan proposé :
1. **Upload audio** (bucket privé, URL signées, quotas de stockage).
2. **Micro-service Python** (analyse audio : BPM, tonalité, énergie,
   placement du flow ; transcription des titres sans paroles écrites) avec
   des modèles sous licence commerciale uniquement ; file de jobs Inngest.
3. **ADN audio** fusionné à l'ADN texte (BPM favori, tonalités, énergie).
4. **Catalogue de prods sous licence** + **espace beatmaker** (dépôt,
   licences types, vérification d'identité/KYC, modération), mode
   « Proposer » : prods recommandées selon l'ADN.
5. **Plans Pro et Label** (stems, multi-profils, export DOCX, quotas
   élevés), **packs de crédits**, crédits mensuels des abonnés annuels.
6. Anti-plagiat par embeddings (pgvector), CSP stricte, traduction anglaise.

Questions à trancher avant de démarrer :
- les leviers de marge (`docs/COSTS.md` §3), en particulier « Sonnet 5.5
  pour les retouches » ;
- le fournisseur de transcription / analyse audio (licence commerciale) ;
- le modèle de rémunération des beatmakers (commission, prix fixes).

## Phase 3 — plus tard

Studio Prod mode « Générer » (fournisseur audio à licence commerciale via
`MusicProvider`), adaptation paroles ↔ prod, collaboration, application
mobile, guide vocal (uniquement avec la voix de l'artiste et son
consentement), paiements des beatmakers via Stripe Connect.
