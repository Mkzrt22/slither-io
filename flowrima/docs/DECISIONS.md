# Décisions prises sans te demander

Le cahier des charges autorisait jusqu'à 5 questions ; aucune information
n'était bloquante, j'ai donc tranché et tout noté ici. Les points marqués
**[à valider]** méritent ton avis au point d'étape.

## Périmètre et organisation

1. **Phases 0 et 1 livrées ensemble**, arrêt avant la phase 2. La phase 0
   (landing, liste d'attente, kit d'entretiens dans `docs/INTERVIEWS.md`)
   est dans la même base de code que le MVP : la landing est la page
   d'accueil du produit.
2. **Dossier `flowrima/`** : le dépôt contient déjà un autre projet (un jeu) à
   la racine. Flowrima y est isolé pour ne rien casser ; sur Vercel, *Root
   Directory* = `flowrima`. Tu pourras le déplacer dans son propre dépôt
   sans rien changer au code.
3. **Pro et Label** sont affichés sur la page Tarifs avec « bientôt » et
   existent en base (quotas prêts), mais ne sont pas vendus avant la phase 2
   (stems, multi-profils, export DOCX n'existent pas encore).
4. **Studio Prod et espace beatmaker** : pages présentes et expliquées
   (« Phase 2 / Phase 3 »), interface `MusicProvider` et prompt 7.3 écrits ;
   aucune génération audio en phase 1. Le grand livre de crédits prod est en
   place (crédits accordés à chaque facture payée, expiration mensuelle) pour
   ne pas avoir à migrer les données plus tard.

## Données et sécurité

5. **Table `profiles` = « users »** du modèle de données : Supabase gère
   l'identité dans `auth.users`, `public.profiles` porte le plan, le rôle, les
   opt-ins et l'onboarding (créé par trigger à l'inscription).
6. **RLS partout + droits par colonne** : un utilisateur ne peut pas modifier
   son plan, son rôle, son statut de vérification, ni les statuts d'analyse.
   Les tables sensibles (abonnements, événements Stripe, crédits, journal
   d'audit, jobs, limites de débit) n'ont aucune politique : seul le serveur
   (clé `service_role`) y écrit.
7. **Quotas atomiques** : `consume_quota` verrouille le profil, compte
   l'usage de la période et enregistre la consommation dans la même
   transaction, *avant* l'appel IA. Deux requêtes simultanées ne peuvent pas
   dépasser le quota. En cas de refus de modération ou d'erreur,
   l'unité est remboursée.
8. **Période de facturation** : mois civil (Europe/Paris) pour le gratuit,
   date anniversaire de l'abonnement pour les payants (y compris l'annuel :
   les quotas restent mensuels).
9. **Limitation de débit dans Postgres** (table `rate_limits`) plutôt que
   Redis : un service de moins à payer et configurer. Si la base ne répond
   pas, la limite laisse passer (les quotas, eux, restent stricts).
10. **Liens plateformes** : uniquement des API officielles (oEmbed Spotify,
    YouTube, SoundCloud ; API Deezer ; iTunes Lookup ; YouTube Data API si
    clé fournie) pour le titre, la pochette, la date, la durée. Liste blanche
    de domaines (anti-SSRF), aucun téléchargement audio, aucun scraping. Les
    paroles sont collées ou envoyées en .txt / .docx.
11. **En-têtes de sécurité** (HSTS, nosniff, frame DENY, referrer,
    permissions) actifs. **CSP stricte à nonce : pas encore** — elle impose
    un rendu dynamique de toutes les pages ; prévue en phase 2 après mesure
    de l'impact sur les performances. **[à valider]**
12. **Sentry** sans IP, cookies, corps de requêtes ni prompts/réponses IA.
    **PostHog** (région UE) chargé **uniquement après consentement**.

## IA

13. **Modèle `claude-opus-5-5` partout**, via `ANTHROPIC_MODEL`, derrière
    l'interface `LLMProvider` (changer de fournisseur = une classe). Efforts :
    `high` ADN, `medium` génération, `low` retouches et assistant, `low` pour
    la pré-analyse d'un titre isolé. Réflexion adaptative, pas de
    température.
14. **Prompts 7.1 et 7.2 implémentés tels quels**, puis affinés (affinages
    séparés et commentés dans `src/lib/ai/prompts/`) :
    - les valeurs propres à chaque demande ({n} syllabes, {fidélité}) sont
      passées dans la demande et non dans les consignes, pour que le préfixe
      mis en cache reste identique d'une génération à l'autre ;
    - les mesures calculées par le code (syllabes, rimes, structure, mots
      signatures) sont fournies au modèle comme données fiables à
      interpréter ;
    - conventions d'écriture (une ligne = une mesure, ad-libs entre
      parenthèses, « / » = respiration), écart de fidélité de B (−20) et C
      (−45), phrase clé placée mot pour mot, « écris comme X » traduit en
      traits de style ;
    - citations de l'ADN limitées à 8 mots ;
    - modération dans la même réponse (champ `safety`) : thèmes durs, rue,
      egotrip, clash sans cible réelle autorisés ; refus seulement pour haine
      envers un groupe protégé, harcèlement ou diffamation d'une personne
      réelle, sexualisation de mineurs.
    Le prompt 7.3 (prod) est une fonction pure qui retire tout nom d'artiste.
15. **Sorties structurées** (`output_config.format` avec un schéma JSON issu
    de zod) + **validation zod côté serveur** de chaque réponse : une réponse
    invalide ou tronquée n'atteint jamais l'utilisateur.
16. **Cache de prompt** : consignes fixes d'abord, puis l'ADN de l'artiste
    avec un point de cache (TTL 1 h pour les générations, 5 min pour les
    retouches), la demande en dernier dans `messages`.
17. **Refus et repli** : `stop_reason: "refusal"` géré (message clair,
    unité remboursée) ; repli serveur `fallbacks: "default"` (bêta
    `server-side-fallback-2026-07-01`) sur les appels interactifs. Pas de
    repli sur la Batch API (non supporté).
18. **Batch API** pour l'analyse ADN au-delà de 25 titres (−50 %), suivie par
    un job Inngest qui interroge le lot jusqu'à la fin.
19. **Streaming** : la route renvoie du NDJSON (début, fragments, fin,
    battements de cœur) ; le navigateur lit le JSON partiel pour afficher les
    3 propositions au fur et à mesure.
20. **Fournisseur simulé (`LLM_PROVIDER=mock`)** : réponses déterministes
    construites à partir de la demande et conformes aux vrais schémas, pour
    développer et tester gratuitement toute la chaîne (quotas,
    anti-recyclage, éditeur, exports). Bandeau « Mode démo » visible quand il est actif.
21. **Plafonds « fair use »** sur les retouches dites illimitées
    (Artiste : 300 retouches, 400 assists, 10 analyses ADN par mois),
    modifiables dans l'admin. Raison : un utilisateur extrême coûterait plus
    qu'il ne rapporte (voir `docs/COSTS.md`). **[à valider]**
22. **Marge** : à 35 % d'utilisation des quotas et ~0,15 $ par génération,
    la marge estimée du plan Artiste est de 63 % (mensuel) / 55 % (annuel),
    sous l'objectif de 70 %. Je n'ai **pas** changé les quotas ni les prix
    du cahier des charges : il faut d'abord mesurer le coût réel. Leviers
    chiffrés dans `docs/COSTS.md` §3. **[à valider]**

## Originalité et droits

23. **Anti-recyclage vérifié par le code** après chaque génération et chaque
    retouche : aucune séquence de 5 mots consécutifs (après normalisation)
    commune avec le catalogue de l'artiste. Une ligne fautive est régénérée
    une fois ; si elle échoue encore, elle est remplacée par un marqueur
    « ligne à réécrire » plutôt que livrée. La phrase gimmick explicitement
    autorisée par l'artiste fait exception.
24. **Anti-plagiat externe, limite assumée** : Flowrima ne possède pas de
    base de paroles d'autres artistes (licences). En phase 1 : consigne au
    modèle + détection de quasi-doublons (trigrammes) sur le catalogue de
    l'artiste. Phase 2 : similarité par embeddings (colonne `vector` prête)
    et, si tu le souhaites, une API de paroles sous licence commerciale.
    **[à valider]**
25. **Part humaine mesurée** : chaque version garde la proportion de lignes
    réécrites par l'artiste (`human_edit_ratio`), affichée dans le studio et
    utile pour la déclaration SACEM (mention dans les CGU et la FAQ).
26. **Aucun entraînement** sur les données des artistes : opt-in désactivé
    par défaut, tracé dans le registre des consentements.

## Paiement

27. **Stripe Checkout + portail client**, TVA via Stripe Tax
    (`automatic_tax`), prix TTC (*inclusive*), numéro de TVA client
    accepté. **Essai de 7 jours** uniquement pour un premier abonnement.
28. **Renonciation au droit de rétractation** : case à cocher obligatoire
    (avec acceptation des CGV) avant le paiement, enregistrée dans le
    registre des consentements avec la version des CGV.
29. **Webhooks** : signature vérifiée, chaque événement enregistré une seule
    fois (`stripe_events`), traitement idempotent ; relance de paiement par
    e-mail + Smart Retries Stripe.
30. **Abonnés annuels et crédits mensuels** : les crédits prod sont accordés
    à chaque facture payée ; pour l'annuel, une distribution mensuelle
    planifiée sera ajoutée en phase 2, quand les crédits deviendront
    utilisables.

## Interface

31. **Thème sombre « studio de nuit » par défaut**, clair au choix (sans
    flash au chargement), accent citron vert `#c6ff2e` sur texte foncé,
    police Geist. Couleurs des familles de rimes = palette catégorielle
    vérifiée pour le daltonisme et le contraste (clair et sombre) ; la lettre
    de la famille est toujours affichée, la couleur n'est jamais le seul
    indice.
32. **Cible de syllabes** affichée seulement sur les couplets et ponts : les
    refrains et intros sont volontairement plus courts.
33. **i18n** : dictionnaires `fr` (source) et `en` ; la langue est fixée par
    `NEXT_PUBLIC_DEFAULT_LOCALE`. Le sélecteur de langue et les URL `/en`
    viendront avec la traduction complète. **[à valider]**
34. **Inngest optionnel** : sans clé, l'analyse ADN tourne en tâche de fond
    (`after()`) ; avec Inngest, elle gagne les reprises automatiques.
35. **Documents légaux** : rédigés comme modèles complets (CGU, CGV,
    confidentialité, cookies, mentions), avec les informations société entre
    crochets et un bandeau « à faire valider par un avocat ». À ne pas
    publier tels quels.
