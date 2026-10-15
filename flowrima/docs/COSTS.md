# Coûts et marge — estimations phase 1

Ces chiffres sont des **estimations avant trafic réel**. Le coût exact de
chaque appel IA est calculé à partir des tokens renvoyés par l'API et
enregistré dans `generations` (colonnes `input_tokens`, `output_tokens`,
`cache_read_tokens`, `cache_write_tokens`, `cost`). Le back-office
(`/app/admin`) affiche le coût moyen par type d'appel, par utilisateur actif et
par plan : **remplace les hypothèses ci-dessous par ces mesures dès les 200
premières générations**, puis ajuste quotas et prix (modifiables dans
`/app/admin/plans` sans redéployer).

Hypothèses de prix : Claude Opus 5.5 à 4 $ / M tokens en entrée, 20 $ / M en
sortie, lecture de cache 0,20 $ / M (0,05×), écriture de cache 1,25× (5 min)
ou 2× (1 h), Batch API −50 %. 1 $ = 0,92 €. Prix TTC des abonnements avec TVA
20 %. Frais Stripe cartes UE ≈ 1,5 % + 0,25 €.

## 1. Coût par opération IA

| Opération | Effort | Entrée (tokens) | Sortie dont réflexion | Coût estimé |
|---|---|---|---|---|
| **Génération** (3 propositions × ~48 mesures) | medium | ~5 k, dont ~4,5 k en cache 1 h (règles + ADN + extraits) | ~7 k (≈ 3,5 k de paroles/JSON + réflexion) | **≈ 0,15 $** (0,10–0,22) |
| **Retouche** d'une ligne/section | low | ~5 k, cache 5 min | ~0,5 k | **≈ 0,015 $** |
| **Assistant** (rimes/synonymes IA) | low | ~1,5 k | ~0,2 k | **≈ 0,006 $** |
| **Analyse ADN** (5–10 titres) | high | ~10 k | ~12 k (JSON + réflexion longue) | **≈ 0,30 $** |
| Analyse ADN > 25 titres | high | Batch API | | −50 % |
| Dictionnaire de rimes, syllabes, anti-recyclage | — | calcul local | | **0 $** |

L'essentiel du coût est la **sortie** (3 chansons complètes + réflexion). Le
cache de prompt divise le coût d'entrée par ~20 dès la 2e génération dans
l'heure. Une génération refusée par la modération ou en erreur est
**remboursée** au quota de l'utilisateur, mais son coût IA est bien compté
dans l'admin.

## 2. Coût IA mensuel par utilisateur

| Profil | Usage mensuel supposé | Coût IA |
|---|---|---|
| Compte gratuit **actif** | ½ analyse ADN, 2,5 générations, 8 retouches, 5 assists | ≈ 0,68 $ = **0,62 €** |
| Compte gratuit moyen (35 % actifs) | | ≈ **0,22 €** |
| **Artiste moyen** (35 % du quota) | 1 ADN, 14 générations, 60 retouches, 40 assists | ≈ 3,54 $ = **3,26 €** |
| Artiste au maximum de ses quotas | 10 ADN, 40 générations, 300 retouches, 400 assists | ≈ 15,90 $ = **14,63 €** |

## 3. Marge brute du plan Artiste

Revenu hors TVA : 10,83 €/mois (mensuel à 12,99 € TTC) ou 8,33 €/mois
(annuel à 9,99 €/mois). On retire frais Stripe, coût IA et ~0,30 € d'hébergement
par abonné.

| Utilisation du quota | Coût/génération 0,10 $ | 0,15 $ (central) | 0,22 $ |
|---|---|---|---|
| 20 % | 79 % / 77 % | 75 % / 70 % | 68 % / 61 % |
| **35 % (hypothèse)** | 71 % / 66 % | **63 % / 55 %** | 50 % / 39 % |
| 60 % | 57 % / 48 % | 43 % / 29 % | 22 % / 2 % |

*(mensuel / annuel)*

**Conclusion honnête : avec les quotas du cahier des charges (40 générations,
retouches « illimitées » en usage raisonnable) et le modèle Opus 5.5 partout,
l'objectif de 70 % de marge n'est atteint que si l'abonné moyen utilise moins
d'un quart de son quota, ou si une génération coûte ≤ 0,10 $.** Les gros
utilisateurs coûtent plus qu'ils ne rapportent (14,63 € d'IA pour 10,83 € de
revenu), d'où les plafonds « fair use » déjà en place (300 retouches,
400 assists, 10 analyses ADN par mois).

Leviers chiffrés (abonné moyen, formule mensuelle) — **à décider ensemble au
point d'étape, rien n'est activé sans ton accord** :

| Levier | Coût IA | Marge |
|---|---|---|
| Situation actuelle | 3,26 € | 63 % |
| Retouches et assists sur Claude Sonnet 5.5 (2 $ / 10 $, qualité suffisante pour des retouches de quelques lignes) | 2,73 € | 68 % |
| Quota Artiste 40 → 30 générations | 2,77 € | 67,5 % |
| **Les deux** | 2,25 € | **72 %** |
| Prix Artiste 12,99 € → 14,99 € | 3,26 € | 68 % |
| Annuel 9,99 € → 10,99 €/mois | 3,26 € | 61 % (au lieu de 55 %) |

Ma recommandation : **mesurer d'abord** (le coût réel par génération peut
être sensiblement plus bas si la réflexion « medium » reste courte), puis
appliquer « Sonnet pour les retouches » si la marge mesurée est sous 70 %.
Ce changement est prévu par l'architecture (`LLMProvider`) mais déroge au
« modèle `claude-opus-5-5` » du cahier des charges, d'où la question.

## 4. Coûts mensuels totaux

Hypothèses : 6 % des inscrits abonnés Artiste (70 % mensuel, 30 % annuel),
94 % gratuits dont 35 % actifs dans le mois. Pro et Label (phase 2) non inclus.

### Hébergement et services

| Service | 100 utilisateurs | 1 000 | 10 000 |
|---|---|---|---|
| Vercel (Pro, obligatoire en usage commercial) | 20 $ | 20 $ | 20 $ + ~40 $ d'usage |
| Supabase (Pro, UE) | 25 $ | 25 $ + 15 $ (instance Small) | 25 $ + 60 $ (Medium) + ~15 $ stockage/trafic |
| Inngest | gratuit | gratuit | ~75 $ (Pro) |
| Resend | gratuit (3 000 e-mails) | 20 $ | 20 $ |
| PostHog UE | gratuit (1 M événements) | gratuit | 0–50 $ |
| Sentry | gratuit | gratuit | 26 $ (Team) |
| Nom de domaine | ~1,5 € | ~1,5 € | ~1,5 € |
| **Total hébergement** | **≈ 45 €** | **≈ 80 €** | **≈ 290 €** |

Prix publics indicatifs 2026 : revérifie-les sur chaque site, ils changent.

### Bilan mensuel

| | 100 utilisateurs | 1 000 | 10 000 |
|---|---|---|---|
| Abonnés Artiste | 6 | 60 | 600 |
| IA des comptes gratuits | 20 € | 204 € | 2 043 € |
| IA des abonnés | 20 € | 195 € | 1 954 € |
| **IA totale** | **40 €** | **400 €** | **≈ 4 000 €** |
| Hébergement | 45 € | 80 € | 290 € |
| Frais Stripe | 2 € | 22 € | 218 € |
| **Coûts totaux** | **≈ 87 €** | **≈ 500 €** | **≈ 4 500 €** |
| Revenu HT | 60 € | 605 € | 6 045 € |
| Résultat brut | −27 € | +103 € | +1 540 € |
| Marge brute globale | négative | 17 % | 25 % |
| Marge sur les seuls abonnés | 61 % | 61 % | 61 % |

**Lecture** : le plan gratuit pèse autant que les abonnés dans la facture IA.
C'est un coût d'acquisition (≈ 3,40 € par mois et par abonné à 6 % de
conversion, bien moins qu'une campagne publicitaire), mais il faut le piloter :
- taux de conversion gratuit → payant (objectif ≥ 5 %, visible dans l'admin) ;
- leviers sur le gratuit si besoin : 3 générations **à l'inscription** puis
  1 par mois (−⅓ du coût du gratuit), retouches gratuites 20 → 10, effort
  « low » pour les générations gratuites ;
- les comptes inactifs ne coûtent rien (aucune IA en tâche de fond).

## 5. Mesurer les vrais coûts

Dans `/app/admin` : coût IA total, par type, par utilisateur actif, par plan,
part du cache, tokens moyens. En SQL (Supabase → SQL Editor) :

```sql
select type, count(*) as appels,
       round(avg(cost)::numeric, 4) as cout_moyen_usd,
       round(avg(output_tokens)) as sortie_moyenne,
       round(sum(cache_read_tokens)::numeric / nullif(sum(cache_read_tokens + input_tokens), 0), 2) as part_cache
from generations
where created_at > now() - interval '30 days' and status in ('done', 'refused', 'blocked')
group by type order by 3 desc;
```

Si `part_cache` des générations est sous 0,5, vérifie que les artistes
enchaînent bien plusieurs générations dans l'heure (sinon le cache 1 h coûte
plus qu'il ne rapporte : passer `lyricsSystem` en cache 5 min dans
`src/lib/ai/prompts/lyrics.ts`).
