-- =============================================================================
-- Flowrima — 004 : Row Level Security + privilèges
--
-- Principe : RLS activée sur TOUTES les tables. Un utilisateur authentifié ne
-- voit et ne modifie que ses lignes (owner_id/user_id = auth.uid()).
-- Les écritures sensibles (plan, quotas, crédits, analyses, générations,
-- abonnements, audit) passent par le serveur avec la clé service_role, qui
-- contourne la RLS — jamais exposée au navigateur.
-- Les privilèges de colonnes empêchent un client de modifier role, plan,
-- statut de vérification, etc. même sur ses propres lignes.
-- =============================================================================

-- On repart d'une base saine : aucun accès implicite.
revoke all on all tables in schema public from anon, authenticated;
grant usage on schema public to anon, authenticated;

do $$
declare t text;
begin
  for t in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- plans : lecture publique (page Tarifs)
-- ---------------------------------------------------------------------------
grant select on public.plans to anon, authenticated;
create policy plans_read on public.plans for select to anon, authenticated using (is_active);

-- ---------------------------------------------------------------------------
-- profiles
-- ---------------------------------------------------------------------------
grant select on public.profiles to authenticated;
grant update (display_name, locale, onboarding_step, marketing_optin, training_optin)
  on public.profiles to authenticated;

create policy profiles_select_own on public.profiles for select to authenticated
  using (id = (select auth.uid()));
create policy profiles_update_own on public.profiles for update to authenticated
  using (id = (select auth.uid())) with check (id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- artist_profiles
-- ---------------------------------------------------------------------------
grant select, delete on public.artist_profiles to authenticated;
grant insert (stage_name, genres, languages, bio, explicit_default)
  on public.artist_profiles to authenticated;
grant update (stage_name, genres, languages, bio, explicit_default)
  on public.artist_profiles to authenticated;

create policy artist_profiles_select_own on public.artist_profiles for select to authenticated
  using (owner_id = (select auth.uid()));
create policy artist_profiles_insert_own on public.artist_profiles for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy artist_profiles_update_own on public.artist_profiles for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy artist_profiles_delete_own on public.artist_profiles for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- platform_links
-- ---------------------------------------------------------------------------
grant select, delete on public.platform_links to authenticated;
grant insert (artist_id, platform, url) on public.platform_links to authenticated;
grant update (platform, url) on public.platform_links to authenticated;

create policy platform_links_select_own on public.platform_links for select to authenticated
  using (owner_id = (select auth.uid()));
create policy platform_links_insert_own on public.platform_links for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.artist_profiles a
                where a.id = artist_id and a.owner_id = (select auth.uid()))
  );
create policy platform_links_update_own on public.platform_links for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy platform_links_delete_own on public.platform_links for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- tracks
-- ---------------------------------------------------------------------------
grant select, delete on public.tracks to authenticated;
grant insert (artist_id, title, release_date, duration_seconds, cover_url, links, lyrics,
              lyrics_source, language, is_explicit, bpm_manual, rights_attested_at)
  on public.tracks to authenticated;
grant update (title, release_date, duration_seconds, cover_url, links, lyrics,
              lyrics_source, language, is_explicit, bpm_manual)
  on public.tracks to authenticated;

create policy tracks_select_own on public.tracks for select to authenticated
  using (owner_id = (select auth.uid()));
create policy tracks_insert_own on public.tracks for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.artist_profiles a
                where a.id = artist_id and a.owner_id = (select auth.uid()))
  );
create policy tracks_update_own on public.tracks for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy tracks_delete_own on public.tracks for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- Lecture seule pour l'utilisateur (écrites par le serveur)
-- ---------------------------------------------------------------------------
grant select on public.track_analyses, public.artist_dna, public.generations,
                 public.subscriptions, public.credit_ledger, public.usage_events,
                 public.jobs, public.beat_licenses
  to authenticated;

create policy track_analyses_select_own on public.track_analyses for select to authenticated
  using (owner_id = (select auth.uid()));
create policy artist_dna_select_own on public.artist_dna for select to authenticated
  using (owner_id = (select auth.uid()));
create policy generations_select_own on public.generations for select to authenticated
  using (owner_id = (select auth.uid()));
create policy subscriptions_select_own on public.subscriptions for select to authenticated
  using (user_id = (select auth.uid()));
create policy credit_ledger_select_own on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()));
create policy usage_events_select_own on public.usage_events for select to authenticated
  using (user_id = (select auth.uid()));
create policy jobs_select_own on public.jobs for select to authenticated
  using (user_id = (select auth.uid()));
create policy beat_licenses_select_own on public.beat_licenses for select to authenticated
  using (buyer_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- projects
-- ---------------------------------------------------------------------------
grant select, delete on public.projects to authenticated;
grant insert (artist_id, title, status, theme, mood, notes, bpm, musical_key)
  on public.projects to authenticated;
grant update (title, status, theme, mood, notes, bpm, musical_key, current_version_id)
  on public.projects to authenticated;

create policy projects_select_own on public.projects for select to authenticated
  using (owner_id = (select auth.uid()));
create policy projects_insert_own on public.projects for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and exists (select 1 from public.artist_profiles a
                where a.id = artist_id and a.owner_id = (select auth.uid()))
  );
create policy projects_update_own on public.projects for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));
create policy projects_delete_own on public.projects for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- lyric_versions : les versions IA sont immuables ; seule la copie de travail
-- (variant = 'edit') est modifiable.
-- ---------------------------------------------------------------------------
grant select, delete on public.lyric_versions to authenticated;
grant insert (project_id, parent_version_id, variant, label, title, content_json,
              content_text, is_ai_generated, human_edit_ratio)
  on public.lyric_versions to authenticated;
grant update (label, title, content_json, content_text, human_edit_ratio)
  on public.lyric_versions to authenticated;

create policy lyric_versions_select_own on public.lyric_versions for select to authenticated
  using (owner_id = (select auth.uid()));
create policy lyric_versions_insert_own on public.lyric_versions for insert to authenticated
  with check (
    owner_id = (select auth.uid())
    and variant = 'edit'
    and exists (select 1 from public.projects p
                where p.id = project_id and p.owner_id = (select auth.uid()))
  );
create policy lyric_versions_update_own on public.lyric_versions for update to authenticated
  using (owner_id = (select auth.uid()) and variant = 'edit')
  with check (owner_id = (select auth.uid()) and variant = 'edit');
create policy lyric_versions_delete_own on public.lyric_versions for delete to authenticated
  using (owner_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- consents : append-only (ni update ni delete côté client)
-- ---------------------------------------------------------------------------
grant select on public.consents to authenticated;
grant insert (kind, granted, version, subject_type, subject_ids, text_snapshot, ip_hash, user_agent)
  on public.consents to authenticated;

create policy consents_select_own on public.consents for select to authenticated
  using (user_id = (select auth.uid()));
create policy consents_insert_own on public.consents for insert to authenticated
  with check (user_id = (select auth.uid()));

-- ---------------------------------------------------------------------------
-- moderation_flags : l'utilisateur peut signaler un contenu qui lui appartient
-- ---------------------------------------------------------------------------
grant select on public.moderation_flags to authenticated;
grant insert (generation_id, lyric_version_id, source, category, reason, excerpt)
  on public.moderation_flags to authenticated;

create policy moderation_flags_select_own on public.moderation_flags for select to authenticated
  using (user_id = (select auth.uid()));
create policy moderation_flags_insert_report on public.moderation_flags for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and source = 'user_report'
    and (lyric_version_id is null or exists (
      select 1 from public.lyric_versions v
      where v.id = lyric_version_id and v.owner_id = (select auth.uid())))
    and (generation_id is null or exists (
      select 1 from public.generations g
      where g.id = generation_id and g.owner_id = (select auth.uid())))
  );

-- ---------------------------------------------------------------------------
-- Marketplace (phase 2) : beatmakers et prods
-- ---------------------------------------------------------------------------
grant select on public.producers to authenticated;
grant insert (display_name) on public.producers to authenticated;
grant update (display_name) on public.producers to authenticated;

create policy producers_select_own on public.producers for select to authenticated
  using (owner_id = (select auth.uid()));
create policy producers_insert_own on public.producers for insert to authenticated
  with check (owner_id = (select auth.uid()));
create policy producers_update_own on public.producers for update to authenticated
  using (owner_id = (select auth.uid())) with check (owner_id = (select auth.uid()));

grant select on public.beats to authenticated;
grant insert (producer_id, title, file_path, preview_path, stems_path, bpm, musical_key, mode,
              genre, mood, tags, price_basic_cents, price_exclusive_cents)
  on public.beats to authenticated;
grant update (title, preview_path, stems_path, bpm, musical_key, mode, genre, mood, tags,
              price_basic_cents, price_exclusive_cents)
  on public.beats to authenticated;
grant delete on public.beats to authenticated;

-- Catalogue : les prods publiées sont visibles par tout utilisateur connecté.
-- (Les chemins de fichiers restent inutilisables sans URL signée du serveur.)
create policy beats_select_published_or_own on public.beats for select to authenticated
  using (
    status = 'published'
    or exists (select 1 from public.producers pr
               where pr.id = producer_id and pr.owner_id = (select auth.uid()))
  );
create policy beats_insert_own on public.beats for insert to authenticated
  with check (exists (select 1 from public.producers pr
                      where pr.id = producer_id and pr.owner_id = (select auth.uid())
                        and pr.status = 'approved'));
create policy beats_update_own on public.beats for update to authenticated
  using (exists (select 1 from public.producers pr
                 where pr.id = producer_id and pr.owner_id = (select auth.uid())))
  with check (exists (select 1 from public.producers pr
                      where pr.id = producer_id and pr.owner_id = (select auth.uid())));
create policy beats_delete_own_unsold on public.beats for delete to authenticated
  using (status <> 'sold_exclusive' and exists (
    select 1 from public.producers pr
    where pr.id = producer_id and pr.owner_id = (select auth.uid())));

-- ---------------------------------------------------------------------------
-- Tables purement serveur : RLS activée, AUCUNE politique => inaccessibles
-- à anon/authenticated : stripe_events, audit_logs, rate_limits, waitlist.
-- ---------------------------------------------------------------------------

-- Le service_role (serveur) garde tous les droits (il contourne la RLS).
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
