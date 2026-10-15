-- =============================================================================
-- Flowrima — 003 : fonctions, triggers, quotas, crédits, rate limiting
-- Toutes les fonctions SECURITY DEFINER fixent search_path = '' et qualifient
-- chaque objet (recommandation Supabase contre le détournement de search_path).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- updated_at automatique
-- ---------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

do $$
declare t text;
begin
  foreach t in array array[
    'plans', 'profiles', 'artist_profiles', 'tracks', 'track_analyses', 'artist_dna',
    'producers', 'beats', 'projects', 'generations', 'subscriptions', 'jobs'
  ] loop
    execute format(
      'create trigger set_updated_at before update on public.%I
         for each row execute function public.set_updated_at()', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- Création du profil à l'inscription (e-mail, Google, Apple)
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id, email, display_name, locale)
  values (
    new.id,
    new.email,
    left(coalesce(
      new.raw_user_meta_data ->> 'display_name',
      new.raw_user_meta_data ->> 'full_name',
      new.raw_user_meta_data ->> 'name',
      split_part(coalesce(new.email, ''), '@', 1)
    ), 80),
    case when new.raw_user_meta_data ->> 'locale' in ('fr', 'en')
         then new.raw_user_meta_data ->> 'locale' else 'fr' end
  )
  on conflict (id) do nothing;
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create or replace function public.handle_user_email_change()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.email is distinct from old.email then
    update public.profiles set email = new.email where id = new.id;
  end if;
  return new;
end $$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row execute function public.handle_user_email_change();

-- ---------------------------------------------------------------------------
-- Rôles
-- ---------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- ---------------------------------------------------------------------------
-- Plans et périodes de facturation
-- ---------------------------------------------------------------------------
-- Valeur entière d'une limite du plan de l'utilisateur (-1 = illimité, 0 si absente)
create or replace function public.plan_limit(p_user uuid, p_key text)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce((pl.limits ->> p_key)::integer, 0)
  from public.profiles p
  join public.plans pl on pl.id = p.plan
  where p.id = p_user;
$$;

create or replace function public.plan_flag(p_user uuid, p_key text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((pl.limits ->> p_key)::boolean, false)
  from public.profiles p
  join public.plans pl on pl.id = p.plan
  where p.id = p_user;
$$;

-- Début de la période de quota en cours.
--  * abonnement mensuel : début de la période Stripe ;
--  * abonnement annuel  : dernier « mois-anniversaire » de la période (quotas mensuels) ;
--  * gratuit            : 1er du mois civil (heure de Paris).
create or replace function public.billing_period_start(p_user uuid)
returns timestamptz language plpgsql stable security definer set search_path = '' as $$
declare
  v_start    timestamptz;
  v_interval text;
  v_months   integer;
begin
  select s.current_period_start, s.billing_interval
    into v_start, v_interval
  from public.subscriptions s
  where s.user_id = p_user
    and s.status in ('trialing', 'active', 'past_due')
    and s.current_period_end > now()
  order by s.current_period_end desc
  limit 1;

  if v_start is null then
    return (date_trunc('month', now() at time zone 'Europe/Paris')) at time zone 'Europe/Paris';
  end if;

  if v_interval = 'year' then
    v_months := (extract(year from age(now(), v_start)) * 12
               + extract(month from age(now(), v_start)))::integer;
    return v_start + make_interval(months => v_months);
  end if;

  return v_start;
end $$;

create or replace function public.feature_limit_key(p_feature public.usage_feature)
returns text language sql immutable set search_path = '' as $$
  select case p_feature
    when 'lyrics_generation' then 'lyrics_generations'
    when 'retouch'           then 'retouches'
    when 'assist'            then 'assists'
    when 'dna_analysis'      then 'dna_analyses'
    when 'export_pdf'        then 'pdf_exports'
    when 'prod_generation'   then 'prod_generations'
  end;
$$;

create or replace function public.usage_in_period(p_user uuid, p_feature public.usage_feature)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(quantity), 0)::integer
  from public.usage_events
  where user_id = p_user
    and feature = p_feature
    and created_at >= public.billing_period_start(p_user);
$$;

-- Consommation ATOMIQUE d'un quota (verrou sur la ligne profil : deux requêtes
-- simultanées ne peuvent pas dépasser la limite). Appelée côté serveur uniquement.
create or replace function public.consume_quota(
  p_user       uuid,
  p_feature    public.usage_feature,
  p_quantity   integer default 1,
  p_reference  text default null,
  p_metadata   jsonb default '{}'::jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit  integer;
  v_used   integer;
  v_event  uuid;
begin
  if p_quantity is null or p_quantity < 1 then
    raise exception 'invalid_quantity';
  end if;

  perform 1 from public.profiles where id = p_user for update;
  if not found then
    raise exception 'unknown_user';
  end if;

  v_limit := public.plan_limit(p_user, public.feature_limit_key(p_feature));
  v_used  := public.usage_in_period(p_user, p_feature);

  if v_limit <> -1 and v_used + p_quantity > v_limit then
    return jsonb_build_object(
      'allowed', false, 'feature', p_feature, 'used', v_used,
      'limit', v_limit, 'remaining', greatest(v_limit - v_used, 0)
    );
  end if;

  insert into public.usage_events (user_id, feature, quantity, reference, metadata)
  values (p_user, p_feature, p_quantity, p_reference, coalesce(p_metadata, '{}'::jsonb))
  returning id into v_event;

  return jsonb_build_object(
    'allowed', true, 'feature', p_feature, 'used', v_used + p_quantity, 'limit', v_limit,
    'remaining', case when v_limit = -1 then -1 else v_limit - v_used - p_quantity end,
    'event_id', v_event
  );
end $$;

-- Annule une consommation (génération échouée / refusée avant tout contenu)
create or replace function public.refund_usage(p_event_id uuid)
returns void language sql security definer set search_path = '' as $$
  delete from public.usage_events where id = p_event_id;
$$;

-- ---------------------------------------------------------------------------
-- Crédits prod (ledger). Deux « poches » : mensuelle (expire au renouvellement)
-- et packs (n'expire pas). La poche est encodée dans la référence :
--   monthly_grant / expiry           -> poche mensuelle
--   pack_purchase / admin_adjust     -> poche packs
--   prod_generation / refund         -> note 'monthly' ou 'pack'
-- ---------------------------------------------------------------------------
create or replace function public.credit_balance(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(sum(delta), 0)::integer from public.credit_ledger where user_id = p_user;
$$;

create or replace function public.monthly_credit_balance(p_user uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select greatest(coalesce(sum(delta), 0), 0)::integer
  from public.credit_ledger
  where user_id = p_user
    and (reason in ('monthly_grant', 'expiry')
         or (reason in ('prod_generation', 'refund') and note = 'monthly'));
$$;

-- Ajout idempotent (référence unique par raison) — renvoie true si inséré
create or replace function public.grant_credits(
  p_user uuid, p_amount integer, p_reason public.credit_reason,
  p_reference text, p_note text default null
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_rows integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  insert into public.credit_ledger (user_id, delta, reason, reference, note)
  values (p_user, p_amount, p_reason, p_reference, p_note)
  on conflict (user_id, reason, reference) where reference is not null do nothing;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end $$;

-- Renouvellement mensuel : expire le reliquat mensuel puis crédite le plan.
create or replace function public.renew_monthly_credits(
  p_user uuid, p_amount integer, p_reference text
) returns boolean language plpgsql security definer set search_path = '' as $$
declare v_left integer;
begin
  perform 1 from public.profiles where id = p_user for update;
  if exists (select 1 from public.credit_ledger
             where user_id = p_user and reason = 'monthly_grant' and reference = p_reference) then
    return false;   -- déjà traité (webhook rejoué)
  end if;
  v_left := public.monthly_credit_balance(p_user);
  if v_left > 0 then
    insert into public.credit_ledger (user_id, delta, reason, reference, note)
    values (p_user, -v_left, 'expiry', p_reference, 'monthly');
  end if;
  if p_amount > 0 then
    insert into public.credit_ledger (user_id, delta, reason, reference, note)
    values (p_user, p_amount, 'monthly_grant', p_reference, 'monthly');
  end if;
  return true;
end $$;

-- Débit atomique : poche mensuelle d'abord, puis packs.
create or replace function public.consume_credits(
  p_user uuid, p_amount integer, p_reference text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_total   integer;
  v_monthly integer;
  v_from_monthly integer;
  v_from_pack    integer;
begin
  if p_amount <= 0 then
    raise exception 'invalid_amount';
  end if;
  perform 1 from public.profiles where id = p_user for update;
  v_total := public.credit_balance(p_user);
  if v_total < p_amount then
    return jsonb_build_object('allowed', false, 'balance', v_total, 'required', p_amount);
  end if;
  v_monthly := least(public.monthly_credit_balance(p_user), v_total);
  v_from_monthly := least(v_monthly, p_amount);
  v_from_pack := p_amount - v_from_monthly;
  if v_from_monthly > 0 then
    insert into public.credit_ledger (user_id, delta, reason, reference, note)
    values (p_user, -v_from_monthly, 'prod_generation', p_reference, 'monthly');
  end if;
  if v_from_pack > 0 then
    insert into public.credit_ledger (user_id, delta, reason, reference, note)
    values (p_user, -v_from_pack, 'prod_generation', p_reference || ':pack', 'pack');
  end if;
  return jsonb_build_object('allowed', true, 'balance', v_total - p_amount);
end $$;

-- ---------------------------------------------------------------------------
-- Tableau de bord des quotas pour l'utilisateur connecté (lecture seule)
-- ---------------------------------------------------------------------------
create or replace function public.my_usage()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_user   uuid := auth.uid();
  v_plan   public.plan_id;
  v_limits jsonb;
  v_result jsonb := '{}'::jsonb;
  f        public.usage_feature;
begin
  if v_user is null then
    return null;
  end if;
  select p.plan, pl.limits into v_plan, v_limits
  from public.profiles p join public.plans pl on pl.id = p.plan
  where p.id = v_user;

  foreach f in array enum_range(null::public.usage_feature) loop
    v_result := v_result || jsonb_build_object(
      f::text, jsonb_build_object(
        'used', public.usage_in_period(v_user, f),
        'limit', coalesce((v_limits ->> public.feature_limit_key(f))::integer, 0)
      ));
  end loop;

  return jsonb_build_object(
    'plan', v_plan,
    'limits', v_limits,
    'period_start', public.billing_period_start(v_user),
    'features', v_result,
    'tracks', (select count(*) from public.tracks where owner_id = v_user),
    'artist_profiles', (select count(*) from public.artist_profiles where owner_id = v_user),
    'credits', public.credit_balance(v_user)
  );
end $$;

-- ---------------------------------------------------------------------------
-- Limites « stock » (titres, profils artistes) : vérifiées à l'insertion
-- ---------------------------------------------------------------------------
create or replace function public.enforce_tracks_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  perform 1 from public.profiles where id = new.owner_id for update;
  v_limit := public.plan_limit(new.owner_id, 'tracks_max');
  if v_limit <> -1
     and (select count(*) from public.tracks where owner_id = new.owner_id) >= v_limit then
    raise exception 'quota_exceeded:tracks_max' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger enforce_tracks_limit
  before insert on public.tracks
  for each row execute function public.enforce_tracks_limit();

create or replace function public.enforce_artist_profiles_limit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limit integer;
begin
  perform 1 from public.profiles where id = new.owner_id for update;
  v_limit := public.plan_limit(new.owner_id, 'artist_profiles_max');
  if v_limit <> -1
     and (select count(*) from public.artist_profiles where owner_id = new.owner_id) >= v_limit then
    raise exception 'quota_exceeded:artist_profiles_max' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger enforce_artist_profiles_limit
  before insert on public.artist_profiles
  for each row execute function public.enforce_artist_profiles_limit();

-- Paroles modifiées => analyse à refaire
create or replace function public.reset_track_analysis()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.lyrics is distinct from old.lyrics then
    new.analysis_status := 'pending';
  end if;
  return new;
end $$;

create trigger reset_track_analysis
  before update on public.tracks
  for each row execute function public.reset_track_analysis();

-- La version courante d'un projet doit appartenir à ce projet
create or replace function public.check_project_current_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.current_version_id is not null and not exists (
    select 1 from public.lyric_versions v
    where v.id = new.current_version_id and v.project_id = new.id
  ) then
    raise exception 'invalid_current_version' using errcode = 'P0001';
  end if;
  return new;
end $$;

create trigger check_project_current_version
  before insert or update of current_version_id on public.projects
  for each row execute function public.check_project_current_version();

-- ---------------------------------------------------------------------------
-- Rate limiting (fenêtre fixe). Renvoie true si la requête est autorisée.
-- ---------------------------------------------------------------------------
create or replace function public.rate_limit_hit(
  p_key text, p_limit integer, p_window_seconds integer
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_count integer;
begin
  insert into public.rate_limits as r (key, window_start, count)
  values (p_key, v_window, 1)
  on conflict (key, window_start) do update set count = r.count + 1
  returning r.count into v_count;

  -- Nettoyage opportuniste des fenêtres expirées
  if random() < 0.01 then
    delete from public.rate_limits where window_start < now() - interval '1 day';
  end if;

  return v_count <= p_limit;
end $$;

-- ---------------------------------------------------------------------------
-- Partage par lien privé : seule cette fonction lit un projet partagé.
-- ---------------------------------------------------------------------------
create or replace function public.get_shared_project(p_token text)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'title', p.title,
    'artist', a.stage_name,
    'bpm', p.bpm,
    'musical_key', p.musical_key,
    'shared_at', p.shared_at,
    'version', jsonb_build_object(
      'title', v.title,
      'content_json', v.content_json,
      'is_ai_generated', v.is_ai_generated,
      'created_at', v.created_at
    )
  )
  from public.projects p
  join public.artist_profiles a on a.id = p.artist_id
  left join public.lyric_versions v on v.id = p.current_version_id
  where p.share_token = p_token
    and p_token is not null
    and char_length(p_token) >= 24;
$$;

-- ---------------------------------------------------------------------------
-- RGPD : export de toutes les données de l'utilisateur connecté
-- ---------------------------------------------------------------------------
create or replace function public.export_my_data()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_user uuid := auth.uid();
begin
  if v_user is null then
    raise exception 'not_authenticated';
  end if;
  return jsonb_build_object(
    'exported_at', now(),
    'profile', (select to_jsonb(p) - 'stripe_customer_id' from public.profiles p where p.id = v_user),
    'artist_profiles', coalesce((select jsonb_agg(to_jsonb(a)) from public.artist_profiles a where a.owner_id = v_user), '[]'),
    'platform_links', coalesce((select jsonb_agg(to_jsonb(l)) from public.platform_links l where l.owner_id = v_user), '[]'),
    'tracks', coalesce((select jsonb_agg(to_jsonb(t)) from public.tracks t where t.owner_id = v_user), '[]'),
    'track_analyses', coalesce((select jsonb_agg(to_jsonb(x) - 'embedding') from public.track_analyses x where x.owner_id = v_user), '[]'),
    'artist_dna', coalesce((select jsonb_agg(to_jsonb(d)) from public.artist_dna d where d.owner_id = v_user), '[]'),
    'projects', coalesce((select jsonb_agg(to_jsonb(pr)) from public.projects pr where pr.owner_id = v_user), '[]'),
    'lyric_versions', coalesce((select jsonb_agg(to_jsonb(v)) from public.lyric_versions v where v.owner_id = v_user), '[]'),
    'generations', coalesce((select jsonb_agg(to_jsonb(g)) from public.generations g where g.owner_id = v_user), '[]'),
    'subscriptions', coalesce((select jsonb_agg(to_jsonb(s)) from public.subscriptions s where s.user_id = v_user), '[]'),
    'credit_ledger', coalesce((select jsonb_agg(to_jsonb(c)) from public.credit_ledger c where c.user_id = v_user), '[]'),
    'usage_events', coalesce((select jsonb_agg(to_jsonb(u)) from public.usage_events u where u.user_id = v_user), '[]'),
    'consents', coalesce((select jsonb_agg(to_jsonb(c)) from public.consents c where c.user_id = v_user), '[]')
  );
end $$;

-- ---------------------------------------------------------------------------
-- Journal d'audit (serveur)
-- ---------------------------------------------------------------------------
create or replace function public.log_audit(
  p_actor uuid, p_action text, p_target_type text, p_target_id text,
  p_metadata jsonb default '{}'::jsonb, p_ip_hash text default null
) returns void language sql security definer set search_path = '' as $$
  insert into public.audit_logs (actor_id, action, target_type, target_id, metadata, ip_hash)
  values (p_actor, p_action, p_target_type, p_target_id, coalesce(p_metadata, '{}'::jsonb), p_ip_hash);
$$;

-- ---------------------------------------------------------------------------
-- Droits d'exécution : fonctions sensibles réservées au service_role.
-- ATTENTION : Supabase accorde EXECUTE par défaut à anon/authenticated sur les
-- nouvelles fonctions. Toute future migration qui crée une fonction sensible
-- doit répéter ce bloc de revoke.
-- ---------------------------------------------------------------------------
revoke execute on all functions in schema public from public, anon, authenticated;

grant execute on function public.is_admin() to authenticated;
grant execute on function public.my_usage() to authenticated;
grant execute on function public.export_my_data() to authenticated;
grant execute on function public.get_shared_project(text) to anon, authenticated;
-- Les fonctions de trigger sont invoquées par le moteur : aucun grant requis.

grant execute on all functions in schema public to service_role;
