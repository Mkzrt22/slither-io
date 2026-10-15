-- =============================================================================
-- Flowrima — 007 : agrégats du back-office (service_role uniquement)
-- KPI : utilisateurs, plans, MRR, churn, coût IA par utilisateur et par
-- fonctionnalité, activation (ADN en moins de 24 h), erreurs, modération.
-- =============================================================================

create or replace function public.admin_metrics(p_days integer default 30)
returns jsonb language sql stable security definer set search_path = '' as $$
  with
  since as (select now() - make_interval(days => p_days) as t),
  prices as (
    select id, price_monthly_cents, coalesce(price_yearly_cents, price_monthly_cents * 12) as price_yearly_cents
    from public.plans
  ),
  active_subs as (
    select s.*, case when s.billing_interval = 'year' then p.price_yearly_cents / 12.0 else p.price_monthly_cents end as mrr_cents
    from public.subscriptions s join prices p on p.id = s.plan
    where s.status in ('active', 'past_due')
  ),
  gens as (
    select g.* from public.generations g, since where g.created_at >= since.t
  ),
  new_users as (
    select p.id, p.created_at from public.profiles p, since where p.created_at >= since.t
  )
  select jsonb_build_object(
    'period_days', p_days,
    'users_total', (select count(*) from public.profiles),
    'users_new', (select count(*) from new_users),
    'by_plan', coalesce((select jsonb_object_agg(plan, n) from (select plan, count(*) n from public.profiles group by plan) x), '{}'),
    'subscriptions', jsonb_build_object(
      'trialing', (select count(*) from public.subscriptions where status = 'trialing'),
      'active', (select count(*) from public.subscriptions where status = 'active'),
      'past_due', (select count(*) from public.subscriptions where status = 'past_due'),
      'canceled_period', (select count(*) from public.subscriptions s, since where s.status = 'canceled' and s.updated_at >= since.t)
    ),
    'mrr_cents', (select coalesce(round(sum(mrr_cents)), 0) from active_subs),
    'churn_rate', (
      select case when (a.n + c.n) = 0 then 0 else round(c.n::numeric / (a.n + c.n), 4) end
      from (select count(*) n from active_subs) a,
           (select count(*) n from public.subscriptions s, since where s.status = 'canceled' and s.updated_at >= since.t) c
    ),
    'ai_cost_usd', (select coalesce(round(sum(cost), 4), 0) from gens),
    'ai_cost_by_type', coalesce((
      select jsonb_object_agg(type, jsonb_build_object(
        'calls', n, 'cost_usd', round(c, 4), 'avg_cost_usd', round(c / nullif(n, 0), 5),
        'avg_input_tokens', round(i / nullif(n, 0)), 'avg_output_tokens', round(o / nullif(n, 0)),
        'cache_read_share', round(cr / nullif(cr + i, 0), 3)))
      from (select type, count(*) n, sum(cost) c, sum(input_tokens) i, sum(output_tokens) o, sum(cache_read_tokens) cr
            from gens where status in ('done', 'refused', 'blocked') group by type) t
    ), '{}'),
    'ai_cost_per_active_user_usd', (
      select round(coalesce(sum(cost), 0) / nullif(count(distinct owner_id), 0), 4) from gens
    ),
    'ai_cost_by_plan_usd', coalesce((
      select jsonb_object_agg(plan, jsonb_build_object('users', u, 'cost_usd', round(c, 4), 'per_user_usd', round(c / nullif(u, 0), 4)))
      from (select p.plan, count(distinct g.owner_id) u, sum(g.cost) c
            from gens g join public.profiles p on p.id = g.owner_id group by p.plan) t
    ), '{}'),
    'generations_by_status', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from gens group by status) x), '{}'),
    'activation_rate', (
      select round(count(*) filter (where exists (
        select 1 from public.artist_dna d where d.owner_id = nu.id and d.status = 'ready'
          and d.created_at <= nu.created_at + interval '24 hours'))::numeric / nullif(count(*), 0), 4)
      from new_users nu
    ),
    'exports_pdf', (select coalesce(sum(quantity), 0) from public.usage_events u, since where u.feature = 'export_pdf' and u.created_at >= since.t),
    'moderation_open', (select count(*) from public.moderation_flags where status = 'open'),
    'errors_7d', (select count(*) from public.generations where status = 'error' and created_at >= now() - interval '7 days'),
    'waitlist', (select count(*) from public.waitlist)
  );
$$;

revoke execute on function public.admin_metrics(integer) from public, anon, authenticated;
grant execute on function public.admin_metrics(integer) to service_role;
