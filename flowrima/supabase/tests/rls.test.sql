-- =============================================================================
-- Tests pgTAP : RLS, privilèges de colonnes, quotas, crédits, partage.
-- Compatible `supabase test db` et `npm run test:db`.
-- Critère d'acceptation : « Un utilisateur ne peut jamais lire les données
-- d'un autre ».
-- =============================================================================
begin;
create extension if not exists pgtap with schema extensions;
set search_path to public, extensions;

select plan(49);

-- Helpers : se connecter « comme » un utilisateur (identique au JWT Supabase)
create function pg_temp.login_as(p_user uuid) returns void language plpgsql as $f$
begin
  perform set_config('request.jwt.claims',
    json_build_object('sub', p_user, 'role', 'authenticated')::text, true);
  set local role authenticated;
end $f$;
create function pg_temp.remember(p_key text, p_value text) returns void language sql as $f$
  select null::void from (select set_config(p_key, p_value, true)) s;
$f$;

-- ---------------------------------------------------------------------------
-- Données de test : deux artistes, Alice et Bob (créés comme par Supabase Auth)
-- ---------------------------------------------------------------------------
insert into auth.users (id, email, raw_user_meta_data) values
  ('00000000-0000-0000-0000-0000000000a1', 'alice@test.dev', '{"display_name":"Alice"}'),
  ('00000000-0000-0000-0000-0000000000b0', 'bob@test.dev',   '{"full_name":"Bob"}');

select is(
  (select count(*)::int from public.profiles where id in
    ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-0000000000b0')),
  2, 'un profil est créé automatiquement à l''inscription');

select is(
  (select count(*)::int from pg_tables where schemaname = 'public' and not rowsecurity),
  0, 'la RLS est activée sur toutes les tables publiques');

-- ---------------------------------------------------------------------------
-- Alice crée son profil artiste, un titre, un projet
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-0000000000a1');

select lives_ok($$
  insert into public.artist_profiles (stage_name, genres) values ('Alice K', '{rap}')
$$, 'Alice crée son profil artiste');

select throws_ok($$
  insert into public.artist_profiles (stage_name) values ('Alice bis')
$$, 'P0001', 'quota_exceeded:artist_profiles_max',
  'le plan Découverte limite à 1 profil artiste');

select lives_ok($$
  insert into public.tracks (artist_id, title, lyrics, rights_attested_at)
  select id, 'Titre 1', 'Je rappe la nuit / sous les néons', now()
  from public.artist_profiles where stage_name = 'Alice K'
$$, 'Alice importe un titre avec attestation de droits');

select throws_ok($$
  insert into public.tracks (artist_id, title, lyrics)
  select id, 'Sans attestation', 'x' from public.artist_profiles where stage_name = 'Alice K'
$$, '23502', null, 'impossible d''importer un titre sans attestation de droits');

select lives_ok($$
  insert into public.tracks (artist_id, title, rights_attested_at)
  select id, t, now() from public.artist_profiles, (values ('Titre 2'), ('Titre 3')) v(t)
  where stage_name = 'Alice K'
$$, 'Alice importe 3 titres au total');

select throws_ok($$
  insert into public.tracks (artist_id, title, rights_attested_at)
  select id, 'Titre 4', now() from public.artist_profiles where stage_name = 'Alice K'
$$, 'P0001', 'quota_exceeded:tracks_max',
  'le 4e titre est refusé sur le plan Découverte');

select lives_ok($$
  insert into public.projects (artist_id, title, theme)
  select id, 'Projet nuit', 'la nuit' from public.artist_profiles where stage_name = 'Alice K'
$$, 'Alice crée un projet');

select lives_ok($$
  insert into public.lyric_versions (project_id, variant, title, content_json, content_text, is_ai_generated)
  select id, 'edit', 'Brouillon', '{"sections":[]}', '[Couplet 1]', false
  from public.projects where title = 'Projet nuit'
$$, 'Alice enregistre une copie de travail');

select throws_ok($$
  insert into public.lyric_versions (project_id, variant, title, content_json, content_text)
  select id, 'A', 'Fausse version IA', '{}', 'x' from public.projects where title = 'Projet nuit'
$$, '42501', null, 'un client ne peut pas forger une version IA (A/B/C)');

-- Colonnes protégées
select throws_ok($$ update public.profiles set plan = 'pro' $$, '42501', null,
  'un utilisateur ne peut pas changer son plan');
select throws_ok($$ update public.profiles set role = 'admin' $$, '42501', null,
  'un utilisateur ne peut pas se promouvoir admin');
select throws_ok($$ update public.artist_profiles set verification_status = 'verified' $$, '42501', null,
  'un utilisateur ne peut pas s''auto-vérifier');
select throws_ok($$ update public.tracks set analysis_status = 'done' $$, '42501', null,
  'le statut d''analyse est réservé au serveur');
select lives_ok($$ update public.profiles set display_name = 'Alice K.' $$,
  'un utilisateur peut modifier son nom affiché');

-- Fonctions serveur interdites au client
select throws_ok($$ select public.consume_quota(auth.uid(), 'lyrics_generation') $$, '42501', null,
  'consume_quota est réservé au serveur');
select throws_ok($$ select public.grant_credits(auth.uid(), 100, 'admin_adjust', 'hack') $$, '42501', null,
  'grant_credits est réservé au serveur');
select throws_ok($$ select public.rate_limit_hit('k', 1, 60) $$, '42501', null,
  'rate_limit_hit est réservé au serveur');

-- Consentements : append-only
select lives_ok($$
  insert into public.consents (kind, granted, version) values ('terms', true, 'cgu-2026-10')
$$, 'Alice enregistre un consentement');
select throws_ok($$ update public.consents set granted = false $$, '42501', null,
  'un consentement ne peut pas être modifié');
select throws_ok($$ delete from public.consents $$, '42501', null,
  'un consentement ne peut pas être supprimé');

select ok((public.my_usage() ->> 'plan') = 'free', 'my_usage renvoie le plan de l''utilisateur connecté');
select pg_temp.remember('test.alice_artist', (select id::text from public.artist_profiles limit 1));

-- ---------------------------------------------------------------------------
-- Bob ne voit RIEN des données d'Alice
-- ---------------------------------------------------------------------------
select pg_temp.login_as('00000000-0000-0000-0000-0000000000b0');

select is_empty($$ select 1 from public.tracks $$, 'Bob ne voit pas les titres d''Alice');
select is_empty($$ select 1 from public.artist_profiles $$, 'Bob ne voit pas le profil artiste d''Alice');
select is_empty($$ select 1 from public.projects $$, 'Bob ne voit pas les projets d''Alice');
select is_empty($$ select 1 from public.lyric_versions $$, 'Bob ne voit pas les paroles d''Alice');
select is_empty($$ select 1 from public.consents $$, 'Bob ne voit pas les consentements d''Alice');
select is(
  (select count(*)::int from public.profiles), 1, 'Bob ne voit que son propre profil');
select is_empty($$ update public.tracks set title = 'piraté' returning id $$,
  'Bob ne peut pas modifier les titres d''Alice');
select is_empty($$ delete from public.projects returning id $$,
  'Bob ne peut pas supprimer les projets d''Alice');
select throws_ok($$
  insert into public.tracks (artist_id, title, rights_attested_at)
  values (current_setting('test.alice_artist')::uuid, 'x', now())
$$, '42501', null, 'Bob ne peut pas insérer un titre sur le profil artiste d''Alice');
select throws_ok($$
  insert into public.projects (artist_id, title)
  values (current_setting('test.alice_artist')::uuid, 'x')
$$, '42501', null, 'Bob ne peut pas créer un projet sur le profil artiste d''Alice');
reset role;

-- ---------------------------------------------------------------------------
-- Anonyme
-- ---------------------------------------------------------------------------
set local role anon;
select isnt_empty($$ select 1 from public.plans $$, 'un visiteur peut lire les plans (page Tarifs)');
select throws_ok($$ select 1 from public.profiles $$, '42501', null, 'un visiteur ne peut pas lire les profils');
select throws_ok($$ insert into public.waitlist (email) values ('spam@test.dev') $$, '42501', null,
  'la liste d''attente n''est pas écrivable directement');
reset role;

-- ---------------------------------------------------------------------------
-- Quotas (serveur / service_role)
-- ---------------------------------------------------------------------------
set local role service_role;
select is(
  (select array_agg((public.consume_quota('00000000-0000-0000-0000-0000000000a1', 'lyrics_generation') ->> 'allowed')::boolean)
   from generate_series(1, 4)),
  array[true, true, true, false],
  'Découverte : 3 générations par mois, la 4e est bloquée');

-- Passage au plan Artiste (comme le ferait le webhook Stripe)
update public.profiles set plan = 'artist' where id = '00000000-0000-0000-0000-0000000000a1';
select ok(
  (public.consume_quota('00000000-0000-0000-0000-0000000000a1', 'lyrics_generation') ->> 'allowed')::boolean,
  'après paiement, l''accès est débloqué immédiatement');

-- Crédits prod : renouvellement idempotent + débit
select ok(public.renew_monthly_credits('00000000-0000-0000-0000-0000000000a1', 5, 'in_001'),
  'crédits mensuels accordés');
select ok(not public.renew_monthly_credits('00000000-0000-0000-0000-0000000000a1', 5, 'in_001'),
  'un webhook rejoué ne crédite pas deux fois');
select is(
  (public.consume_credits('00000000-0000-0000-0000-0000000000a1', 2, 'gen_1') ->> 'balance')::int,
  3, 'débit de crédits prod');
select ok(public.renew_monthly_credits('00000000-0000-0000-0000-0000000000a1', 5, 'in_002'),
  'renouvellement du mois suivant');
select is(public.credit_balance('00000000-0000-0000-0000-0000000000a1'), 5,
  'le reliquat mensuel expire au renouvellement (pas de cumul)');
select is(
  (public.consume_credits('00000000-0000-0000-0000-0000000000a1', 9, 'gen_2') ->> 'allowed')::boolean,
  false, 'débit refusé si le solde est insuffisant');

-- Partage par lien privé
update public.projects set share_token = 'tok_0123456789abcdefghijklmnop', shared_at = now()
  where title = 'Projet nuit';
reset role;
set local role anon;
select is(public.get_shared_project('tok_0123456789abcdefghijklmnop') ->> 'title', 'Projet nuit',
  'un lien de partage valide donne accès au projet partagé');
select is(public.get_shared_project('tok_inexistant_000000000000000'), null,
  'un jeton inconnu ne renvoie rien');
reset role;

-- La version courante d'un projet doit lui appartenir
select pg_temp.login_as('00000000-0000-0000-0000-0000000000b0');
select lives_ok($$
  insert into public.artist_profiles (stage_name) values ('Bob B')
$$, 'Bob crée son profil artiste');
select lives_ok($$
  insert into public.projects (artist_id, title)
  select id, 'Projet Bob' from public.artist_profiles
$$, 'Bob crée un projet');
reset role;
select pg_temp.remember('test.alice_version',
  (select id::text from public.lyric_versions where title = 'Brouillon'));
select pg_temp.login_as('00000000-0000-0000-0000-0000000000b0');
select throws_ok($$
  update public.projects set current_version_id = current_setting('test.alice_version')::uuid
$$, 'P0001', 'invalid_current_version',
  'Bob ne peut pas pointer son projet vers les paroles d''Alice (fuite via partage)');
reset role;

select * from finish();
rollback;
