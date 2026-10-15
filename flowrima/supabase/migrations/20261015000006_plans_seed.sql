-- =============================================================================
-- Flowrima — 006 : référentiel des plans (modifiable ensuite depuis l'admin)
-- -1 = illimité. Les retouches « illimitées » sont plafonnées par un usage
-- raisonnable (fair use) pour protéger la marge — voir docs/COSTS.md.
-- =============================================================================

insert into public.plans (id, name, price_monthly_cents, price_yearly_cents, limits, sort_order)
values
  ('free', 'Découverte', 0, null, '{
     "tracks_max": 3, "lyrics_generations": 3, "retouches": 20, "assists": 30,
     "dna_analyses": 3, "pdf_exports": 0, "prod_credits_monthly": 0, "prod_generations": 0,
     "artist_profiles_max": 1, "pdf_export": false, "prod_ai": false, "stems": false,
     "history_days": 30, "priority": false
   }'::jsonb, 0),
  ('artist', 'Artiste', 1299, 11988, '{
     "tracks_max": 30, "lyrics_generations": 40, "retouches": 300, "assists": 400,
     "dna_analyses": 10, "pdf_exports": -1, "prod_credits_monthly": 5, "prod_generations": -1,
     "artist_profiles_max": 1, "pdf_export": true, "prod_ai": true, "stems": false,
     "history_days": 365, "priority": false
   }'::jsonb, 1),
  ('pro', 'Pro', 2999, null, '{
     "tracks_max": -1, "lyrics_generations": 150, "retouches": 1000, "assists": 1500,
     "dna_analyses": 30, "pdf_exports": -1, "prod_credits_monthly": 25, "prod_generations": -1,
     "artist_profiles_max": 1, "pdf_export": true, "prod_ai": true, "stems": true,
     "history_days": -1, "priority": true
   }'::jsonb, 2),
  ('label', 'Label / Studio', 9900, null, '{
     "tracks_max": -1, "lyrics_generations": 400, "retouches": 3000, "assists": 4000,
     "dna_analyses": 60, "pdf_exports": -1, "prod_credits_monthly": 80, "prod_generations": -1,
     "artist_profiles_max": 5, "pdf_export": true, "prod_ai": true, "stems": true,
     "history_days": -1, "priority": true
   }'::jsonb, 3)
on conflict (id) do update
  set name = excluded.name,
      price_monthly_cents = excluded.price_monthly_cents,
      price_yearly_cents = excluded.price_yearly_cents,
      sort_order = excluded.sort_order;
-- NB : on ne réécrase pas "limits" si la ligne existe : l'admin a pu les ajuster.
